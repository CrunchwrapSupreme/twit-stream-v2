/* eslint-disable max-lines-per-function */
/* eslint-disable func-names */
const JParseStream = require('../lib/parse_stream');
const PassThroughStream = require('stream').PassThrough;

describe('TweetStreamParser', function() {
  this.timeout(10000);

  it('should process a chunk of tweet JSON and emit a tweet event', function(done) {
    let stream = new PassThroughStream();
    let client = new JParseStream();
    stream.pipe(client);
    client.on('tweet', () => done());
    client.on('stream-error', (e) => done(e));
    stream.write(`{"data": {"test":"dave"}}\r\n`, 'utf8');
    stream.destroy();
  });

  it('should process a chunk of invalid JSON and emit an stream-error event', function(done) {
    let stream = new PassThroughStream();
    let client = new JParseStream();
    stream.pipe(client);
    client.on('tweet', () => done(new Error('Should not emit a tweet')));
    client.on('stream-error', () => done());
    stream.write(`{"data": "test":"dave"}}\r\n`);
    stream.destroy();
  });

  it('should process a chunk of error JSON and emit an stream-error event', function(done) {
    let stream = new PassThroughStream();
    let client = new JParseStream();
    stream.pipe(client);
    client.on('tweet', () => done(new Error('Should not emit a tweet')));
    client.on('api-errors', () => done());
    stream.write(`{"errors": {"test":"dave"}}\r\n`);
    stream.destroy();
  });

  it('should process a chunk of unknown JSON and emit an stream-error event', function(done) {
    let stream = new PassThroughStream();
    let client = new JParseStream();
    stream.pipe(client);
    client.on('tweet', () => done(new Error('Should not emit a tweet')));
    client.on('stream-error', (e) => done(e));
    client.on('other', () => done());
    stream.write(`{"other": {"test":"dave"}}\r\n`);
    stream.destroy();
  });

  it('should process a heartbeat and emit a heartbeat event', function(done) {
    let stream = new PassThroughStream();
    let client = new JParseStream();
    stream.pipe(client);
    client.on('tweet', () => done(new Error('Should not emit a tweet')));
    client.on('stream-error', (e) => done(e));
    client.on('heartbeat', () => done());
    stream.write(`\r\n`);
    stream.destroy();
  });
});
