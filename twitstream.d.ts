declare class StreamClient {
  constructor(x: {token: string, timeout: number, stream_timeout: number});

  connect(x: {
    params: object,
    max_reconnects: number,
    writeable_stream: Stream
  }): Promise<Error> | Promise<void>;

  disconnect(): void;
}
