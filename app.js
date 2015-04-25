var express = require('express');
var nunjucks = require('nunjucks');
var async = require('async');
var todolist = require('todo-list');
var _ = require('underscore');
var _request = require('request');
var cache = require('./cache');
var fs = require('fs');
require('sugar');

// GitHub API Client
var githubapi = require("github");
var github = new githubapi({
  version: "3.0.0",
  protocol: "https",
  host: "api.github.com"
});

var app = express();

nunjucks.configure('templates', {
  autoescape: true,
  express: app,
  watch: true
});

app.set('port', (process.env.PORT || 3000))
app.use(express.static('public'));

function get_context(code, line) {
  var lines = code.split(/\r*\n/);
  var CONTEXT = 4;
  var start = _.max([0, line - CONTEXT]);
  var end = _.min([lines.length - 1, line + CONTEXT]);
  return lines.slice(start, end).join('\n');
}

function render_list(user, repo, commit, items, request, response) {
  response.render('repo.html', {
    user: user,
    repo: repo,
    commit: commit,
    items_by_type: _.groupBy(items, "type"),
    items_by_file: _.groupBy(items, "file"),
    items_by_assignee: _.groupBy(items, "assignee")
  });
}

// TODO(rameshvarun): Add SVG Badge Route
app.get('/:user/:repo/badges/:type', function(request, response) {
	var imgurl = "https://img.shields.io/badge/TODOs-1%20Items-green.svg";
});

var IGNORE_LINES = _.map(fs.readFileSync('ignoretypes.txt', 'utf8').split(/\r*\n/), function(line) {
  return line.trim();
});
var DEFAULT_IGNORE_TYPES =  _.reject(IGNORE_LINES, function(line) {
  return line.startsWith("#") || line.length == 0;
})
console.log("Loaded deafult ignore types...");

// TODO(rameshvarun): Allow user to see TODOs of a specific commit
// TODO(rameshvarun): Allow user to see TODOs of a specific branch

// Route that access the tip of the default branch
app.get('/:user/:repo', function(request, response) {
	// TODO: Better error messages

  // Get the info for this github repo
  github.repos.get({
    user: request.params.user,
    repo: request.params.repo
  }, function(err, result) {
    if (err) {
      response.send(err);
    } else {
      // Get information on the default branch
      var default_branch = result.default_branch;
      github.repos.getBranch({
        user: request.params.user,
        repo: request.params.repo,
        branch: default_branch
      }, function(err, result) {
        if (err) {
          response.send(err);
        } else {
          var sha = result.commit.sha;
          // Check to see if the current commit is in the cache
          cache.checkCache(sha, function(commit_items_callback) {
            github.gitdata.getTree({
              user: request.params.user,
              repo: request.params.repo,
              sha: sha,
              recursive: true
            }, function(err, result) {
              if (err) {
                commit_items_callback(err);
              } else {
                async.mapSeries(result.tree, function(file, callback) {
                  var ignore = _.any(DEFAULT_IGNORE_TYPES, function(type) {
                    return file.path.endsWith(type);
                  })

                  if(ignore) {
                    console.log("Ignoring " + file.path + "...")
                    callback(null, []);
                    return;
                  }

                  // Check to see if we have already processed this file sha
                  cache.checkCache(file.sha, function(file_items_callback) {
                    var url = "https://raw.githubusercontent.com/" +
                      request.params.user + "/" + request.params.repo +
                      "/" + sha + "/" + file.path;

                    _request(url, function(error, response, body) {
                      if (error) {
                        file_items_callback(error);
                      } else {
                        var marks = todolist.findMarks(body);
                        _.each(marks, function(mark) {
                          mark.file = file.path;
                          mark.context = get_context(body, mark.line);
                        });
                        file_items_callback(null, marks);
                      }
                    });
                  }, function(err, file_items) {
                    callback(err, file_items);
                  });
                }, function(err, results) {
                  if (err) {
                    commit_items_callback(err);
                  } else {
                    var items = _.flatten(results);
                    commit_items_callback(null, items);
                  }
                });
              }
            });
          }, function(err, commit_items) {
            if (err) {
              response.send(err);
            }
            render_list(request.params.user, request.params.repo, sha, commit_items, request, response);
          })
        }
      })
    }
  });
});

app.listen(app.get('port'), function() {
  console.log("Listening on localhost:" + app.get('port') + "...");
});