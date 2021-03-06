var levelup = require('level');
var memjs = require('memjs');

var IN_HEROKU = process.env.MEMCACHEDCLOUD_SERVERS != null;

// Setup datastore client
var db, client;
if(IN_HEROKU) {
	console.log("Using MemcachedCloud to cache data.");
	client = memjs.Client.create(process.env.MEMCACHEDCLOUD_SERVERS, {
		username: process.env.MEMCACHEDCLOUD_USERNAME,
		password: process.env.MEMCACHEDCLOUD_PASSWORD
	});
} else {
	console.log("Using LevelDB to cache data.");
	db = levelup('./cache');
}

/**
 * Checks that cache for a given key. If the key has
 * an associated value, it is immediately passed to proceed.
 * If the key is not in the cache, we call generate_data
 * which creates the data, puts it in the cache, and calls proceed.
 * @param {string} key - The key of this data in the cache
 * @param generate_data - A function that should generate the data.
 *     It is passed a callback, of prototype function(err, data)
 * @param proceed - a function(err, data), which proceeds with the data
 */
function checkCache(key, generate_data, proceed) {
  if(IN_HEROKU) checkMemcached(key, generate_data, proceed);
  else checkLevelDBCache(key, generate_data, proceed);
}
module.exports.checkCache = checkCache;

function checkLevelDBCache(key, generate_data, proceed) {
  // Check for the Key in the database
  db.get(key, function(err, value) {
    if (err) { // Key not found
      // Call the data generation callback
      generate_data(function(err, data) {
        if (err) { // Error generating data
          proceed(err);
        } else {
          // Save generated data to DB
          db.put(key, JSON.stringify(data), function(err) {
            if (err) {
              console.error("Could not persist " + key + " to cache.");
            } else {
              console.log("Wrote " + key + " to cache.");
            }
          });
          proceed(null, data);
        }
      });
    } else { // Key found, pass on the value
      console.log("Read " + key + " from cache.");
      proceed(null, JSON.parse(value));
    }
  });
}

function checkMemcached(key, generate_data, proceed) {
  // Check for the Key in the database
  client.get(key, function(err, value) {
    if (value == null) { // Key not found
      // Call the data generation callback
      generate_data(function(err, data) {
        if (err) { // Error generating data
          proceed(err);
        } else {
          // Save generated data to DB
          client.set(key, JSON.stringify(data), function(err, val) {
            if (val) {
              console.log("Wrote " + key + " to cache.");
            } else {
              console.error("Could not persist " + key + " to cache.");
            }
          });
          proceed(null, data);
        }
      });
    } else { // Key found, pass on the value
      console.log("Read " + key + " from cache.");
      proceed(null, JSON.parse(value));
    }
  });
}