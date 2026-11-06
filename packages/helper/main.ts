#!/usr/bin/env -S deno run --allow-all

import { Message, MessageType, systemBus, Variant } from "dbus-next";

const SERVICE_NAME = "org.linux_wrapper_starter.Helper1";
const INTERFACE_NAME = "org.linux_wrapper_starter.Helper1";
const OBJECT_PATH = "/org/linux_wrapper_starter/Helper1";
const GET_ROOT_IDENTITY_ACTION =
  "org.linux_wrapper_starter.Helper1.get-root-identity";
const IDLE_TIMEOUT_MS = 60_000;
const POLKIT_DEST = "org.freedesktop.PolicyKit1";
const POLKIT_PATH = "/org/freedesktop/PolicyKit1/Authority";
const POLKIT_IFACE = "org.freedesktop.PolicyKit1.Authority";
const POLKIT_ALLOW_USER_INTERACTION = 1;
const DBUS_REQUEST_NAME_PRIMARY_OWNER = 1;

const bus = systemBus();

// dbus-next's typings declare the request as a string; at runtime it is the incoming Message.
const replyError = (msg: Message, name: string, text: string) =>
  bus.send(
    (Message.newError as unknown as (
      m: Message,
      n: string,
      t: string,
    ) => Message)(msg, name, text),
  );
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let pendingCalls = 0;

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pendingCalls > 0) return;
    console.log(`[Helper] Idle for ${IDLE_TIMEOUT_MS / 1000}s, exiting`);
    Deno.exit(0);
  }, IDLE_TIMEOUT_MS);
}

async function isAuthorized(
  sender: string,
  actionId: string,
): Promise<boolean> {
  const reply = await bus.call(
    new Message({
      destination: POLKIT_DEST,
      path: POLKIT_PATH,
      interface: POLKIT_IFACE,
      member: "CheckAuthorization",
      signature: "(sa{sv})sa{ss}us",
      body: [
        ["system-bus-name", { name: new Variant("s", sender) }],
        actionId,
        {},
        POLKIT_ALLOW_USER_INTERACTION,
        "",
      ],
    }),
  );
  // Reply signature is (bba{ss}); the first struct field is is_authorized.
  return Boolean(reply?.body[0][0]);
}

async function getRootIdentity(msg: Message, sender: string) {
  try {
    if (!await isAuthorized(sender, GET_ROOT_IDENTITY_ACTION)) {
      replyError(
        msg,
        `${SERVICE_NAME}.Error.NotAuthorized`,
        "Not authorized by Polkit",
      );
      return;
    }

    const output = await new Deno.Command("id", {
      args: [],
      clearEnv: true,
      env: { PATH: "/usr/bin:/bin" },
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr).trim();
      replyError(msg, `${SERVICE_NAME}.Error.Failed`, stderr || "id failed");
      return;
    }

    const identity = new TextDecoder().decode(output.stdout).trim();
    bus.send(Message.newMethodReturn(msg, "s", [identity]));
  } catch (error) {
    replyError(msg, `${SERVICE_NAME}.Error.Internal`, String(error));
  }
}

// Method calls are dispatched synchronously by dbus-next with their full message,
// so the sender is captured here per call rather than through shared state.
bus.addMethodHandler((msg: Message) => {
  if (
    msg.type !== MessageType.METHOD_CALL || msg.path !== OBJECT_PATH ||
    msg.interface !== INTERFACE_NAME
  ) {
    return false;
  }

  resetIdleTimer();
  const sender = msg.sender;

  if (!sender) {
    replyError(
      msg,
      `${INTERFACE_NAME}.Error.Internal`,
      "Could not identify sender",
    );
    return true;
  }

  if (msg.member !== "GetRootIdentity") {
    replyError(
      msg,
      "org.freedesktop.DBus.Error.UnknownMethod",
      `Unknown method ${msg.member}`,
    );
    return true;
  }

  pendingCalls++;
  getRootIdentity(msg, sender).finally(() => {
    pendingCalls--;
    resetIdleTimer();
  });
  return true;
});

async function main() {
  bus.on("error", (err: unknown) => {
    console.error("[Helper] D-Bus error:", err);
    Deno.exit(1);
  });

  const result = await bus.requestName(SERVICE_NAME, 0);
  if (result !== DBUS_REQUEST_NAME_PRIMARY_OWNER) {
    console.error(
      `[Helper] Could not acquire ${SERVICE_NAME} (reply ${result})`,
    );
    Deno.exit(1);
  }

  console.log(`[Helper] Serving ${SERVICE_NAME} at ${OBJECT_PATH}`);
  resetIdleTimer();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[Helper] Failed to start:", err);
    Deno.exit(1);
  });
}
