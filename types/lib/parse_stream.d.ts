export = TweetStreamParser;
declare class TweetStreamParser {
    constructor(options: any);
    emitr: any;
    timer: any;
    parseJSON(): void;
    chunkBuffer: any;
    _transform(chunk: any, encoding: any, callback: any): any;
    encoding: any;
    /**
     * Clear the chunk buffer
     */
    _flush(callback: any): any;
}
