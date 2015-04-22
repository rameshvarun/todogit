global.PORT = (process.env.PORT || 80);

var express = require('express');
var nunjucks = require('nunjucks');
var async = require('async');

var githubapi = require("github");
var github = new githubapi({
    version: "3.0.0",
    protocol: "https",
    host: "api.github.com"
});

var app = express();
var server = require('http').Server(app);

app.use(express.static('public'));

app.get('/:user/:repo', function(request, response){
	github.repos.get({
        user: request.params.user,
        repo: request.params.repo
    }, function(err, result) {
        if(err) response.send(err);
        else {
            var default_branch = result.default_branch;
            github.repos.getBranch({
                user: request.params.user,
                repo: request.params.repo,
                branch: default_branch
            }, function(err, result) {
                if(err) response.send(err);
                else {
                    var sha = result.commit.sha;
                    github.gitdata.getTree({
                        user: request.params.user,
                        repo: request.params.repo,
                        sha: sha,
                        recursive: true
                    }, function(err, result) {
                       if(err) response.send(err);
                       else {
                           async.mapSeries(result.tree, function(file, callback) {
                               github.gitdata.getBlob({
                                   user: request.params.user,
                                   repo: request.params.repo,
                                   sha: file.sha
                               }, function (err, result) {
                                   if(err) callback(err);
                                   else {
                                   	  var buffer = new Buffer(result.content, result.encoding);
                                   	  callback(null, {
                                   	  	path: file.path,
                                   	  	content: buffer.toString()
                                   	  });
                                   }
                               })
                           }, function(err, results) {
                                if(err) response.send(err);
                                else {
                                	// TODO: Actually parse files
                                	response.send(results);
                                }
                           });
                       }
                    });
                }
            })
        }
    });
});

server.listen(global.PORT, 'localhost', function() {
	console.log("Listening on localhost:" + PORT + "...");
});