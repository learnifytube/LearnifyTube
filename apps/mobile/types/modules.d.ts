declare module "react-native-zeroconf" {
  export interface ZeroconfService {
    name: string;
    host: string;
    port: number;
    addresses?: string[];
    txt?: Record<string, string>;
  }

  class Zeroconf {
    scan(type?: string, protocol?: string, domain?: string): void;
    stop(): void;
    publishService(
      type: string,
      protocol: string,
      domain: string,
      name: string,
      port: number,
      txt?: Record<string, string>
    ): void;
    unpublishService(name: string): void;
    on(event: "resolved", callback: (service: ZeroconfService) => void): void;
    on(event: "remove", callback: (name: string) => void): void;
    on(event: "error", callback: (error: Error) => void): void;
    on(event: "start" | "stop" | "found" | "update", callback: () => void): void;
    removeAllListeners(event: string): void;
    removeListener(event: string, callback: (...args: never[]) => void): void;
  }

  export default Zeroconf;
}

declare module "react-native-tcp-socket" {
  import { EventEmitter } from "events";

  interface AddressInfo {
    port: number;
    address: string;
    family: string;
  }

  interface Socket extends EventEmitter {
    write(data: string | Buffer | Uint8Array, encoding?: string): boolean;
    destroy(): void;
    end(data?: string | Buffer, encoding?: string): void;
    address(): AddressInfo | null;
    on(event: "data", listener: (data: Buffer) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: (hadError: boolean) => void): this;
    on(event: "connect", listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  interface Server extends EventEmitter {
    listen(options: { port: number; host?: string }, callback?: () => void): this;
    close(callback?: () => void): void;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "connection", listener: (socket: Socket) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  interface TcpSocketStatic {
    createServer(connectionListener?: (socket: Socket) => void): Server;
    createConnection(
      options: { port: number; host: string },
      callback?: () => void
    ): Socket;
  }

  const TcpSocket: TcpSocketStatic;
  export default TcpSocket;
}
