import { Message, systemBus } from "dbus-next";

export const HELPER_SERVICE = "org.linux_wrapper_starter.Helper1";
export const HELPER_OBJECT_PATH = "/org/linux_wrapper_starter/Helper1";
export const HELPER_INTERFACE = "org.linux_wrapper_starter.Helper1";

const CALL_TIMEOUT_MS = 10_000;

export interface RootIdentity {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Calls GetRootIdentity on the privileged helper over the system bus.
 * Returns the output in a format expected by the frontend.
 */
export async function getRootIdentity(): Promise<RootIdentity> {
  const result: RootIdentity = {
    command: "GetRootIdentity()",
    exitCode: 0,
    stdout: "",
    stderr: "",
  };

  try {
    const bus = systemBus();
    const message = new Message({
      destination: HELPER_SERVICE,
      path: HELPER_OBJECT_PATH,
      interface: HELPER_INTERFACE,
      member: "GetRootIdentity",
    });

    const reply = await withTimeout(
      bus.call(message),
      CALL_TIMEOUT_MS,
      "Timed out waiting for the helper (authorization may be pending)",
    );

    if (reply?.body && reply.body.length > 0) {
      result.stdout = String(reply.body[0]);
    }
    return result;
  } catch (err) {
    result.exitCode = 1;
    result.stderr = err instanceof Error ? err.message : String(err);
    console.error(`GetRootIdentity failed: ${result.stderr}`);
    return result;
  }
}
