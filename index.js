var exec = require('child_process').exec;
var fs = require('fs');
var pos = require('pos');
var request = require('request');
var _ = require('underscore');
_.mixin( require('underscore.deferred') );
var inflection = require('inflection');
var wordfilter = require('wordfilter');
var wordnikKey = require('./permissions.js').key;
var sp = require('wordsworth').getInstance();
var giphy = require('giphy-wrapper')('dc6zaTOxFJmzC');
var Twitter = require('node-twitter');
var conf = require('./config.js');
var twitterRestClient = new Twitter.RestClient(
  conf.consumer_key,
  conf.consumer_secret,
  conf.access_token,
  conf.access_token_secret
);
var TWEET = true;

var cities = [
  'Manhattan',
  'Brooklyn',
  'New York',
  'Los Angeles',
  'Portland',
  'Seattle',
  'Boston',
  'Houston',
  'Dallas',
  'Chicago',
  'Miami',
  'Atlanta',
  'San Francisco',
  'Oakland',
  'The Mission'
];

function initSpell() {
  var dfd = new _.Deferred();
  sp.initialize('seed.txt', 'training.txt', function() {
    //console.log('Initialized!');
    dfd.resolve('done');
  });
  return dfd.promise();
}

Array.prototype.pick = function() {
  return this[Math.floor(Math.random()*this.length)];
};

Array.prototype.pickRemove = function() {
  var index = Math.floor(Math.random()*this.length);
  return this.splice(index,1)[0];
};

function ing(word) {
  var result = '';

  // if it ends in b, double the b
  // grab -> grabb
  if (word[word.length-1] === 'b') {
    word = word + 'b';
  }

  // if it ends in r, double the r
  // refer -> referring
  if (word[word.length-1] === 'r') {
    word = word + 'r';
  }

  // if it ends in ie, make it a y
  // vie -> vy
  if (word.substr(word.length-2, word.length-1) === 'ie') {
    word = word.substr(0, word.length-2) + 'y';
  }

  // if it ends in e, cut the e
  if (word[word.length-1] === 'e') {
    word = word.substr(0, word.length-1);
  }

  result = word + 'ing';

  return result;
}

function getPos(word) {
  var words = new pos.Lexer().lex(word);
  var tags = new pos.Tagger().tag(words);
  var part = tags[0][1];
  return part;
}

function getSuggestions(word) {
  var dfd = new _.Deferred();
  request('http://api.wordnik.com/v4/word.json/'+word+'?useCanonical=false&includeSuggestions=true&api_key='+wordnikKey, function(err, resp, body) {
    var result = '';
    var data = JSON.parse(body);
    //console.log(data);
    dfd.resolve(result);
  });
  return dfd.promise();
}

function getVerb() {
  var dfd = new _.Deferred();
  request('http://api.wordnik.com/v4/words.json/randomWords?hasDictionaryDef=true&excludePartOfSpeech=adjective,noun,proper-noun,proper-noun-plural,proper-noun-posessive,suffix,family-name,idiom,affix&includePartOfSpeech=verb-transitive&minCorpusCount=20000&maxCorpusCount=-1&minDictionaryCount=5&maxDictionaryCount=-1&minLength=-1&maxLength=-1&sortBy=count&sortOrder=desc&limit=1000&api_key='+wordnikKey, function(err, resp, body) {
    var data = JSON.parse(body);
    var verbs = _.chain(data)
                 .pluck('word')
                 .map(function(el) {
                   return ing(el);
                 })
                 // only accept gerunds
                 .filter(function(el) {
                   var part = getPos(el);
                   return part === 'VBG';
                 })
                 .value();
    var verb = verbs.pick();
    dfd.resolve(verb);
  });
  return dfd.promise();
}

function getPhrase(word) {
  var dfd = new _.Deferred();
  request('http://api.wordnik.com/v4/word.json/' + word + '/phrases?limit=100&wlmi=0&useCanonical=false&api_key='+wordnikKey, function(err, resp, body) {
    var phrases = JSON.parse(body);
    //console.log(body);
    // only get phrases that start with the word, and only where the second word is a noun of some kind
    phrases = _.chain(phrases)
               .map(function(el) {
                 if (el.gram2.indexOf('\'s') > -1) {
                   el.gram2 = el.gram2.replace('\'s','');
                 }
                 return el;
               })
               .filter(function(el) {
                 var part = getPos(el.gram2);
                 return el.gram1 === word &&
                        // gotta be nouns
                        part.indexOf('NN') > -1 &&
                        // no plural nouns
                        part.indexOf('NNP') === -1 &&
                        // no nouns with weird capitalization
                        el.gram2.toLowerCase() === el.gram2 &&
                        // no both
                        el.gram2 !== 'both' &&
                        // no apostrophe words except stuff like "everyone's" which was already
                        // changed to "everyone" in the prior `.map`
                        el.gram2.indexOf('\'') === -1;
               })
               .map(function(el) {
                 if (
                   el.gram2 !== 'everyone' &&
                   el.gram2 !== 'someone'
                   ) {
                   el.gram2 = inflection.pluralize(el.gram2);
                 }
                 return el;
               })
               .value();

    //console.log(phrases);

    if (phrases.length > 0) {
      var phrase = phrases.pick();
      phrase = 'men ' + phrase.gram1 + ' ' + phrase.gram2 + (Math.random() > 1 ? '' : ' in ' + cities.pick());
      phrase = inflection.titleize(phrase);
      //console.log(phrase);
      dfd.resolve(phrase);
    }
    else {
      dfd.reject('');
    }
  });
  return dfd.promise();
}

function generate() {
  var dfd = new _.Deferred();
  _.when(
    getVerb(),
    initSpell()
  ).done(function(verb) {
    //console.log(verb);
    if (!sp.exists(verb)) {
      newSpell = sp.suggest(verb)[0];
      if (newSpell) {
        verb = newSpell;
        //console.log('NEW SPELLING:', verb);
      }
    }
    getPhrase(verb)
      .done(function(phrase) {
        giphy.search('fail', 100, Math.floor(Math.random()*20)*100, function(err, data) {
          if (err) {
            console.log('error',err);
          }
          var result = data.data.pick().images.original.url;
          console.log(result);
          request(result).pipe(fs.createWriteStream('out.gif').on('close', function() {
            console.log('GIF written!');
            dfd.resolve(phrase);
          }));
        });
      })
      .fail(function(phrase) {
        // try again
        tweet();
      });
  });
  return dfd.promise();
}

function tweet() {
  generate().then(function(myTweet) {
    if (!wordfilter.blacklisted(myTweet)) {
      console.log(myTweet);
      if (TWEET) {
        twitterRestClient.statusesUpdateWithMedia({
            'status': myTweet,
            'media[]': 'out.gif'
          },
          function(error, result) {
            if (error) {
              console.log('Error: ' + (error.code ? error.code + ' ' + error.message : error.message));
            }
            if (result) {
              console.log(result);
            }
        });
      }
    }
  });
}

// Tweet once on initialization
tweet();
