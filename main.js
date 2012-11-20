var queryHero = require('./app/data/mysql').queryHero;
var config = require('./app/config/config');
var Robot = require('pomelo-robot').Robot;
var fs = require('fs');

var robot = new Robot(config);

if (robot.server==='master') {
    robot.runMaster(__filename);
} else {
    var mysql =config[robot.env].mysql;
    console.error('%j',mysql);
    var Client = require('mysql').Client;
    var client = new Client();
    client.host = mysql.host;
    client.user = mysql.user;
    client.password = mysql.password;
    client.database = mysql.database;
    var args = process.argv;
    var i = 5;
    var limit = args[i++];
    var offset= args[i++];
    var script = fs.readFileSync(process.cwd() + '/app/config/lord.js', 'utf8');
    queryHero(client,limit,offset,function(error,users){robot.runAgent(users,script);});
}

process.on('uncaughtException', function(err) {
	console.error(' Caught exception: ' + err);
	fs.appendFile('.log', err.stack, function (err) { });
	setTimeout(function(){
		process.exit(1);
	},10000)
});
