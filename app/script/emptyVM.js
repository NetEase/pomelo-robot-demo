// var heapdump = require('heapdump');
var sio = require('socket.io-client');

process.on('uncaughtException', function(err) {
  console.error(' Caught exception: ' + err.stack);
});
