var express = require('express');
var nunjucks = require('nunjucks');
var async = require('async');
var todolist = require('todo-list');
var _ = require('underscore');
var _request = require('request');
var cache = require('./cache');
var fs = require('fs');
var slash = require('express-slash');

require('sugar');

// GitHub API Client
var githubapi = require("github");
var github = new githubapi({
  version: "3.0.0",
  protocol: "https",
  host: "api.github.com"
});

if (process.env.GITHUB_TOKEN) {
  github.authenticate({
    type: "oauth",
    token: process.env.GITHUB_TOKEN
  });
  console.log("Authenticated with GitHub API...");
}


var app = express();
app.enable('strict routing');
app.use(slash());

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
app.get('/:user/:repo/badges/:type.svg', function(request, response) {
  getDefaultBranchItems(request.params.user, request.params.repo, function(err, items, sha) {
    if(err) response.send(err);
    else {
      var type;
      if(request.params.type.toLowerCase() == "todos") type = "TODOs";
      else if (request.params.type.toLowerCase() == "notes") type = "NOTEs";
      else if (request.params.type.toLowerCase() == "fixmes") type = "FIXMEs";

      var items = _.filter(items, function(item) { return item.type == type; })

      var imgurl = "https://img.shields.io/badge/" + type + "-" + items.length + "%20Items-green.svg";
      _request(imgurl, function(err, httpresponse, body) {
        if(err) response.send(err);
        else {
          response.type("image/svg+xml").send(body);
        }
      });
      
    }
  });
});

var IGNORE_LINES = _.map(fs.readFileSync('ignoretypes.txt', 'utf8').split(/\r*\n/), function(line) {
  return line.trim();
});
var DEFAULT_IGNORE_TYPES = _.reject(IGNORE_LINES, function(line) {
  return line.startsWith("#") || line.length == 0;
})

console.log("Loaded deafult ignore types...");

// TODO(rameshvarun): Allow user to see TODOs of a specific commit
// TODO(rameshvarun): Allow user to see TODOs of a specific branch

function getDefaultBranchItems(user, repo, branch_items_callback) {
 // Get the info for this github repo
  github.repos.get({
    user: user,
    repo: repo
  }, function(err, result) {
    if (err) {
      branch_items_callback(err);
    } else {
      // Get information on the default branch
      var default_branch = result.default_branch;
      github.repos.getBranch({
        user: user,
        repo: repo,
        branch: default_branch
      }, function(err, result) {
        if (err) {
          branch_items_callback(null);
        } else {
          var sha = result.commit.sha;
          // Check to see if the current commit is in the cache
          cache.checkCache(sha, function(commit_items_callback) {
            github.gitdata.getTree({
              user: user,
              repo: repo,
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


                  if (ignore) {
                    console.log("Ignoring " + file.path + "...")
                    callback(null, []);
                    return;
                  }

                  // Check to see if we have already processed this file sha
                  cache.checkCache(file.sha, function(file_items_callback) {
                    var url = "https://raw.githubusercontent.com/" +
                      user + "/" + repo +
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
              branch_items_callback(null);
            }
            branch_items_callback(null, commit_items, sha);
          })
        }
      })
    }
  });
}

// Route that access the tip of the default branch
app.get('/:user/:repo/', function(request, response) {
  // TODO: Better error messages
  getDefaultBranchItems(request.params.user, request.params.repo, function(err, items, sha) {
    if(err) response.send(err);
    else render_list(request.params.user, request.params.repo, sha, items, request, response);
  });
});

app.listen(app.get('port'), function() {
  console.log("Listening on localhost:" + app.get('port') + "...");
});