#pomelo-robot-demo
pomelo-robot is simple tool to benchmark the socket.io server performance.

pomelo-robot can run in multiple mode such as single machine with many process
,distribute test many socket.io server.

pomelo-robot execute developer custom JavaScript in a sand box and static
monitor include max(min,avg) response time and QPS,etc. then report to web http
server with graph display

pomelo-robot also can be used in http benchmark by developer script;  


##Start
```
node app master

Then. please visited http://localhost:8889/


###Notice
when pomelo-robot run in distribute mode, every client should be in same
directory path and master could be ssh login automatic. Otherwise developer can
start up agent by self,for the custom script, the demo is attachment.
