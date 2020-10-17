const StreamClient = require('../index');
const PassThroughStream = require('stream').PassThrough;

describe('StreamClient', function() {
  this.timeout(10000);

  describe('#processChunk(chunk)', function() {
    it('should process a chunk of tweet JSON and emit a tweet event', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      client.on('tweet', () => done());
      client.on('error', (e) => done(e));
      client.processChunk(Buffer.from(`{"data": {"test":"dave"}}\r\n`));
    });

    it('should process a chunk of invalid JSON and emit an error event', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      client.on('tweet', () => done(new Error('Should not emit a tweet')));
      client.on('error', () => done());
      client.processChunk(Buffer.from(`{"data": "test":"dave"}}\r\n`));
    });

    it('should process a chunk of error JSON and emit an error-api event', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      client.on('tweet', () => done(new Error('Should not emit a tweet')));
      client.on('error', (e) => done(e));
      client.on('error-api', () => done());
      client.processChunk(Buffer.from(`{"errors": {"test":"dave"}}\r\n`));
    });

    it('should process a chunk of unknown JSON and emit an error-api event', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      client.on('tweet', () => done(new Error('Should not emit a tweet')));
      client.on('error', (e) => done(e));
      client.on('other', () => done());
      client.processChunk(Buffer.from(`{"other": {"test":"dave"}}\r\n`));
    });

    it('should process a heartneat and emit a heartbeat event', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      client.on('tweet', () => done(new Error('Should not emit a tweet')));
      client.on('error', (e) => done(e));
      client.on('heartbeat', () => done());
      client.processChunk(Buffer.from(`\r\n`));
    });
  });

  describe('#flush()', function() {
    it('should process any remaining data in the chunk buffer and emit any events', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      client.chunkBuffer = Buffer.from(`{"data": {"test":"dave"}}\r\n`);
      client.on('tweet', () => done());
      client.on('error', (e) => done(e));
      client.flush();
    });
  });

  describe('#buildStreamPromise(response)', function () {
    it('should emit close when #disconnect() is called', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.on('close', () => done());
      client.buildStreamPromise(response_mock).catch((e) => done(e));
      setTimeout(() => client.disconnect(), 1000);
    });

    it('should emit close when the response stream is destroyed', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.on('close', () => done());
      client.buildStreamPromise(response_mock).catch((e) => done(e));
      setTimeout(() => stream.destroy(), 1000);
    });

    it('should emit tweet without a timeout when it is streamed in', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.on('tweet', () => done());
      client.buildStreamPromise(response_mock).catch(() => done(e));
      stream.write(`{"data":{"test":"dave"}}\r\n`);
      stream.destroy();
    });

    it('should reject with an error when stream emits error', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.buildStreamPromise(response_mock).catch(() => done());
      stream.emit('error', new Error('Fake error'));
      stream.destroy();
    });
  });

  describe('#connect({ params: object, max_connects: number})', function() {
    it('should reject after max_connects attempts');
    it('should resolve on disconnect');
    it('should reject on unretriable error');
  });
});
