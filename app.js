global.PORT = (process.env.PORT || 80);

var express = require('express');
var nunjucks = require('nunjucks');

var app = express();
var server = require('http').Server(app);

app.use(express.static('public'));

app.get('/:user/:repo', function(req, res){
	res.end(req.params);
});

server.listen(global.PORT, 'localhost', function() {
	console.log("Listening on localhost:" + PORT + "...");
});