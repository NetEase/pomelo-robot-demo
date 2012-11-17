var io = require('socket.io-client');
var uri =  "127.0.0.1:8888";    

var Agent = function(){
}

var agent = new Agent();

Agent.prototype.init = function(){
	var agent = this;
	agent.socket = io.connect(uri);
	agent.socket.on('connect', function() {
      agent.socket.emit('announce_web_client');
			console.log("Connected to server, sending announcement...");
			agent.notify();
			agent.connected = true;
			agent.reconnecting = false;
			agent.last_heartbeat = new Date().getTime();
	});
}

var data = {agent:1,maxuser:20,robot:'',time:10};

Agent.prototype.notify = function(){
	this.socket.emit('ready',data);
	setTimeout(this.go,10000);
}

Agent.prototype.go = function(){
		agent.socket.emit('run',data);
	  console.log(' emit go');
}

agent.init();
