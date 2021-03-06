/**
 * @author      Created by Marcus Spiegel <marcus.spiegel@gmail.com> on 2011-03-25.
 * @link        https://github.com/mashpie/i18n-node
 * @license     http://opensource.org/licenses/MIT
 *
 * @version     0.6.0
 */

// dependencies and "private" vars
var Mustache;
var vsprintf = require('sprintf-js').vsprintf,
  fs = require('fs'),
  url = require('url'),
  path = require('path'),
  debug = require('debug')('i18n:debug'),
  warn = require('debug')('i18n:warn'),
  error = require('debug')('i18n:error'),
  locales = {},
  api = [
    '__',
    '__n',
    'getLocale',
    'setLocale',
    'getCatalog',
    'getLocales',
    'addLocale',
    'removeLocale'
  ];
var pathsep = path.sep || '/'; // ---> means win support will be available in node 0.8.x and above

// public exports
var i18n = exports;

i18n.options = {
  cookiename: null,
  queryParameter: null,
  directory: __dirname + pathsep + 'locales',
  directoryPermissions: null,
  updateFiles: true,
  indent: "\t",
  prefix: '',
  extension: '.json',
  defaultLocale: 'en',
  autoReload: false,
  objectNotation: false,
  fallbacks: {},
  retryInDefaultLocale: false,
  logDebugFn: debug,
  logWarnFn: warn,
  logErrorFn: error
};

i18n.version = '0.6.0';

i18n.configure = function i18nConfigure(opt) {

  // you may register helpers in global scope, up to you
  if (typeof opt.register === 'object') {
    applyAPItoObject(opt.register);
  }

  // sets a custom cookie name to parse locale settings from
  i18n.options.cookiename = (typeof opt.cookie === 'string') ? opt.cookie : null;

  // query-string parameter to be watched
  i18n.options.queryParameter = (typeof opt.queryParameter === 'string') ? opt.queryParameter : null;

  // where to store json files
  i18n.options.directory = (typeof opt.directory === 'string') ? opt.directory : __dirname + pathsep + 'locales';

  // permissions when creating new directories
  i18n.options.directoryPermissions = (typeof opt.directoryPermissions === 'string') ? parseInt(opt.directoryPermissions, 8) : null;

  // write new locale information to disk
  i18n.options.updateFiles = (typeof opt.updateFiles === 'boolean') ? opt.updateFiles : true;

  // what to use as the indentation unit (ex: "\t", "  ")
  i18n.options.indent = (typeof opt.indent === 'string') ? opt.indent : "\t";

  // json files prefix
  i18n.options.prefix = (typeof opt.prefix === 'string') ? opt.prefix : '';

  // where to store json files
  i18n.options.extension = (typeof opt.extension === 'string') ? opt.extension : '.json';

  // setting defaultLocale
  i18n.options.defaultLocale = (typeof opt.defaultLocale === 'string') ? opt.defaultLocale : 'en';

  // allow to retry in default locale, useful for production
  i18n.options.retryInDefaultLocale = (typeof opt.retryInDefaultLocale == 'boolean') ? opt.retryInDefaultLocale : false;

  // auto reload locale files when changed
  i18n.options.autoReload = (typeof opt.autoReload === 'boolean') ? opt.autoReload : false;

  // enable object notation?
  i18n.options.objectNotation = (typeof opt.objectNotation !== 'undefined') ? opt.objectNotation : false;
  if (i18n.options.objectNotation === true) i18n.options.objectNotation = '.';

  // read language fallback map
  i18n.options.fallbacks = (typeof opt.fallbacks === 'object') ? opt.fallbacks : {};

  // setting custom logger functions
  i18n.options.logDebugFn = (typeof opt.logDebugFn === 'function') ? opt.logDebugFn : debug;
  i18n.options.logWarnFn = (typeof opt.logWarnFn === 'function') ? opt.logWarnFn : warn;
  i18n.options.logErrorFn = (typeof opt.logErrorFn === 'function') ? opt.logErrorFn : error;

  // when missing locales we try to guess that from directory
  opt.locales = opt.locales || guessLocales(i18n.options.directory);

  // implicitly read all locales
  if (Array.isArray(opt.locales)) {
    opt.locales.forEach(function(l) {
      read(l);
    });

    // auto reload locale files when changed
    if (i18n.options.autoReload) {

      // watch changes of locale files (it's called twice because fs.watch is still unstable)
      fs.watch(i18n.options.directory, function(event, filename) {

        // @todo: add support for prefixed files
        var re = new RegExp(i18n.options.extension + '$');
        if (filename && filename.match(re)) {
          var locale = filename.replace(re, '');
          if (opt.locales.indexOf(locale) > -1) {
            logDebug("Auto reloading locale file '" + filename + "'.");
            read(locale);
          }
        }
      });
    }
  }
};

i18n.init = function i18nInit(request, response, next) {
  if (typeof request === 'object') {
    guessLanguage(request);

    if (typeof response === 'object') {
      applyAPItoObject(request, response);

      // register locale to res.locals so hbs helpers know this.locale
      if (!response.locale) response.locale = request.locale;

      if (response.locals) {
        applyAPItoObject(request, response.locals);

        // register locale to res.locals so hbs helpers know this.locale
        if (!response.locals.locale) response.locals.locale = request.locale;
      }
    }

    // bind api to req also
    applyAPItoObject(request);
  }

  if (typeof next === 'function') {
    next();
  }
};

i18n.__ = function i18nTranslate(phrase) {
  var msg, namedValues, args;

  // Accept an object with named values as the last parameter
  // And collect all other arguments, except the first one in args
  if (
    arguments.length > 1 &&
    arguments[arguments.length - 1] !== null &&
    typeof arguments[arguments.length - 1] === "object"
  ) {
    namedValues = arguments[arguments.length - 1];
    args = Array.prototype.slice.call(arguments, 1, -1);
  } else {
    namedValues = {};
    args = arguments.length >= 2 ? Array.prototype.slice.call(arguments, 1) : [];
  }

  // called like __({phrase: "Hello", locale: "en"})
  if (typeof phrase === 'object') {
    if (typeof phrase.locale === 'string' && typeof phrase.phrase === 'string') {
      msg = translate(phrase.locale, phrase.phrase);
    }
  }
  // called like __("Hello")
  else {
    // get translated message with locale from scope (deprecated) or object
    msg = translate(getLocaleFromObject(this), phrase);
  }

  // if the msg string contains {{Mustache}} patterns we render it as a mini tempalate
  if ((/{{.*}}/).test(msg)) {
    msg = i18n._renderMustach(msg, namedValues);
  }

  // if we have extra arguments with values to get replaced,
  // an additional substition injects those strings afterwards
  if ((/%/).test(msg) && args && args.length > 0) {
    msg = vsprintf(msg, args);
  }

  return msg;
};

i18n.__n = function i18nTranslatePlural(singular, plural, count) {
  var msg, namedValues, args = [];

  // Accept an object with named values as the last parameter
  if (
    arguments.length >= 2 &&
    arguments[arguments.length - 1] !== null &&
    typeof arguments[arguments.length - 1] === "object"
  ) {
    namedValues = arguments[arguments.length - 1];
    args = arguments.length >= 5 ? Array.prototype.slice.call(arguments, 3, -1) : [];
  } else {
    namedValues = {};
    args = arguments.length >= 4 ? Array.prototype.slice.call(arguments, 3) : [];
  }

  // called like __n({singular: "%s cat", plural: "%s cats", locale: "en"}, 3)
  if (typeof singular === 'object') {
    if (typeof singular.locale === 'string' && typeof singular.singular === 'string' && typeof singular.plural === 'string') {
      msg = translate(singular.locale, singular.singular, singular.plural);
    }
    args.unshift(count);
    // some template engines pass all values as strings -> so we try to convert them to numbers
    if (typeof plural === 'number' || parseInt(plural, 10) + "" === plural) {
      count = plural;
    }

    // called like __n({singular: "%s cat", plural: "%s cats", locale: "en", count: 3})
    if (typeof singular.count === 'number' || typeof singular.count === 'string') {
      count = singular.count;
      args.unshift(plural);
    }
  } else {
    // called like  __n('cat', 3)
    if (typeof plural === 'number' || parseInt(plural, 10) + "" === plural) {
      count = plural;
      args.unshift(count);
      args.unshift(plural);
    }
    // called like __n('%s cat', '%s cats', 3)
    // get translated message with locale from scope (deprecated) or object
    msg = translate(getLocaleFromObject(this), singular, plural);
  }
  if (count === null) count = namedValues.count;

  // parse translation and replace all digets '%d' by `count`
  // this also replaces extra strings '%%s' to parseble '%s' for next step
  // simplest 2 form implementation of plural, like https://developer.mozilla.org/en/docs/Localization_and_Plurals#Plural_rule_.231_.282_forms.29
  if (count > 1) {
    msg = vsprintf(msg.other, [parseInt(count, 10)]);
  } else {
    msg = vsprintf(msg.one, [parseInt(count, 10)]);
  }

  // if the msg string contains {{Mustache}} patterns we render it as a mini tempalate
  if ((/{{.*}}/).test(msg)) {
    msg = i18n._renderMustach(msg, namedValues);
  }

  // if we have extra arguments with strings to get replaced,
  // an additional substition injects those strings afterwards
  if ((/%/).test(msg) && args && args.length > 0) {
    msg = vsprintf(msg, args);
  }

  return msg;
};

i18n.setLocale = function i18nSetLocale(locale_or_request, locale) {
  var target_locale = locale_or_request,
    request;

  // called like setLocale(req, 'en')
  if (locale_or_request && typeof locale === 'string') {
    request = locale_or_request;
    target_locale = locale;
  }

  // called like req.setLocale('en')
  if (locale === undefined && typeof this.locale === 'string' && typeof locale_or_request === 'string') {
    request = this;
    target_locale = locale_or_request;
  }

  if (!locales[target_locale] && i18n.options.fallbacks[target_locale]) {
    target_locale = i18n.options.fallbacks[target_locale];
  }

  if (locales[target_locale]) {

    // called like i18n.setLocale('en')
    if (request === undefined) {
      i18n.options.defaultLocale = target_locale;
    } else {
      request.locale = target_locale;
    }
  } else {
    if ((request !== undefined)) {
      request.locale = i18n.options.defaultLocale;
    }
  }

  return i18n.getLocale(request);
};

i18n.getLocale = function i18nGetLocale(request) {

  // called like getLocale(req)
  if (request && request.locale) {
    return request.locale;
  }

  // called like req.getLocale()
  if (request === undefined && typeof this.locale === 'string') {
    return this.locale;
  }

  // called like getLocale()
  return i18n.options.defaultLocale;
};

i18n.getCatalog = function i18nGetCatalog(locale_or_request, locale) {
  var target_locale = locale_or_request;

  // called like getCatalog(req)
  if (typeof locale_or_request === 'object' && typeof locale_or_request.locale === 'string') {
    target_locale = locale_or_request.locale;
  }

  // called like getCatalog(req, 'en')
  if (typeof locale_or_request === 'object' && typeof locale === 'string') {
    target_locale = locale;
  }

  // called like req.getCatalog()
  if (locale === undefined && typeof this.locale === 'string') {
    target_locale = this.locale;
  }

  // called like req.getCatalog('en')
  if (locale === undefined && typeof locale_or_request === 'string') {
    target_locale = locale_or_request;
  }

  // called like getCatalog()
  if (target_locale === undefined || target_locale === '') {
    return locales;
  }

  if (!locales[target_locale] && i18n.options.fallbacks[target_locale]) {
    target_locale = i18n.options.fallbacks[target_locale];
  }

  if (locales[target_locale]) {
    return locales[target_locale];
  } else {
    logWarn('No catalog found for "' + target_locale + '"');
    return false;
  }
};

i18n.getLocales = function i18nGetLocales() {
  return Object.keys(locales);
};

i18n.addLocale = function i18nAddLocale(locale) {
  read(locale);
};

i18n.removeLocale = function i18nRemoveLocale(locale) {
  delete locales[locale];
};

i18n._renderMustach = function renderMustach(msg, namedValues) {
  if (!Mustache) {
    try {
      Mustache = require('mustache');
    } catch (error) {
      if (error.code == 'MODULE_NOT_FOUND' || error.message.indexOf("Cannot find module") != -1) {
        console.log("You need to run 'npm install mustache --save' in order to use mustache placeholders");
        console.log(error.stack);
        return msg;
      } else {
        throw error;
      }
    }
  }
  return Mustache.render(msg, namedValues);
};

i18n.serializeLocale = function serializeLocal (localeObj) {
  return JSON.stringify(localeObj, null, i18n.options.indent);
};

i18n.deserializeLocale = function serializeLocal (fileContent) {
  return JSON.parse(fileContent);
};

// ===================
// = private methods =
// ===================
/**
 * registers all public API methods to a given response object when not already declared
 */

function applyAPItoObject(request, response) {

  // attach to itself if not provided
  var object = response || request;
  api.forEach(function(method) {

    // be kind rewind, or better not touch anything already exiting
    if (!object[method]) {
      object[method] = function() {
        return i18n[method].apply(object, arguments);
      };
    }
  });
}

/**
 * tries to guess locales by scanning the given directory
 */
function guessLocales(directory) {
  var extensionRegex = new RegExp(i18n.options.extension + '$', 'g');
  var prefixRegex = new RegExp('^' + i18n.options.prefix, "g");
  var entries = fs.readdirSync(directory);
  var localesFound = [];

  for (var i = entries.length - 1; i >= 0; i--) {
    if (entries[i].match(/^\./)) continue;
    if (i18n.options.prefix && !entries[i].match(prefixRegex)) continue;
    if (i18n.options.extension && !entries[i].match(extensionRegex)) continue;
    localesFound.push(entries[i].replace(i18n.options.prefix, '').replace(extensionRegex, ''));
  }

  return localesFound.sort();
}

/**
 * guess language setting based on http headers
 */

function guessLanguage(request) {
  if (typeof request === 'object') {
    var language_header = request.headers['accept-language'],
      languages = [],
      regions = [];

    request.languages = [i18n.options.defaultLocale];
    request.regions = [i18n.options.defaultLocale];
    request.language = i18n.options.defaultLocale;
    request.region = i18n.options.defaultLocale;

    // a query parameter overwrites all
    if (i18n.options.queryParameter && request.url) {
      var urlObj = url.parse(request.url, true);
      if (urlObj.query[i18n.options.queryParameter]) {
        logDebug("Overriding locale from query: " + urlObj.query[i18n.options.queryParameter]);
        request.language = urlObj.query[i18n.options.queryParameter].toLowerCase();
        return i18n.setLocale(request, request.language);
      }
    }

    // a cookie overwrites headers
    if (i18n.options.cookiename && request.cookies && request.cookies[i18n.options.cookiename]) {
      request.language = request.cookies[i18n.options.cookiename];
      return i18n.setLocale(request, request.language);
    }

    // 'accept-language' is the most common source
    if (language_header) {
      var accepted_languages = getAcceptedLanguagesFromHeader(language_header),
        match, fallbackMatch, fallback;
      for (var i = 0; i < accepted_languages.length; i++) {
        var lang = accepted_languages[i],
          lr = lang.split('-', 2),
          parentLang = lr[0],
          region = lr[1];

        // Check if we have a configured fallback set for this language.
        if (i18n.options.fallbacks && i18n.options.fallbacks[lang]) {
          fallback = i18n.options.fallbacks[lang];
          // Fallbacks for languages should be inserted where the original, unsupported language existed.
          var acceptedLanguageIndex = accepted_languages.indexOf(lang);
          if (accepted_languages.indexOf(fallback) < 0) {
            accepted_languages.splice(acceptedLanguageIndex + 1, 0, fallback);
          }
        }

        // Check if we have a configured fallback set for the parent language of the locale.
        if (i18n.options.fallbacks && i18n.options.fallbacks[parentLang]) {
          fallback = i18n.options.fallbacks[parentLang];
          // Fallbacks for a parent language should be inserted to the end of the list, so they're only picked
          // if there is no better match.
          if (accepted_languages.indexOf(fallback) < 0) {
            accepted_languages.push(fallback);
          }
        }

        if (languages.indexOf(parentLang) < 0) {
          languages.push(parentLang.toLowerCase());
        }
        if (region) {
          regions.push(region.toLowerCase());
        }

        if (!match && locales[lang]) {
          match = lang;
          break;
        }

        if (!fallbackMatch && locales[parentLang]) {
          fallbackMatch = parentLang;
        }
      }

      request.language = match || fallbackMatch || request.language;
      request.region = regions[0] || request.region;
      return i18n.setLocale(request, request.language);
    }
  }

  // last resort: defaultLocale
  return i18n.setLocale(request, i18n.options.defaultLocale);
}

/**
 * Get a sorted list of accepted languages from the HTTP Accept-Language header
 */
function getAcceptedLanguagesFromHeader(header) {
  var languages = header.split(','),
    preferences = {};
  return languages.map(function parseLanguagePreference(item) {
    var preferenceParts = item.trim().split(';q=');
    if (preferenceParts.length < 2) {
      preferenceParts[1] = 1.0;
    } else {
      var quality = parseFloat(preferenceParts[1]);
      preferenceParts[1] = quality ? quality : 0.0;
    }
    preferences[preferenceParts[0]] = preferenceParts[1];

    return preferenceParts[0];
  }).filter(function(lang) {
    return preferences[lang] > 0;
  }).sort(function sortLanguages(a, b) {
    return preferences[b] - preferences[a];
  });
}

/**
 * searches for locale in given object
 */

function getLocaleFromObject(obj) {
  var locale;
  if (obj && obj.scope) {
    locale = obj.scope.locale;
  }
  if (obj && obj.locale) {
    locale = obj.locale;
  }
  return locale;
}

/**
 * read locale file, translate a msg and write to fs if new
 */

function translate(locale, singular, plural) {
  if (locale === undefined) {
    logWarn("WARN: No locale found - check the context of the call to __(). Using " + i18n.options.defaultLocale + " as current locale");
    locale = i18n.options.defaultLocale;
  }

  if (!locales[locale] && i18n.options.fallbacks[locale]) {
    locale = i18n.options.fallbacks[locale];
  }

  // attempt to read when defined as valid locale
  if (!locales[locale]) {
    read(locale);
  }

  // fallback to default when missed
  if (!locales[locale]) {
    logWarn("WARN: Locale " + locale + " couldn't be read - check the context of the call to $__. Using " + i18n.options.defaultLocale + " (default) as current locale");
    locale = i18n.options.defaultLocale;
    read(locale);
  }

  // This allow pass default value as 'greeting.formal:Hello'
  var defaultSingular = singular;
  var defaultPlural = plural;
  if (i18n.options.objectNotation) {
    var indexOfColon = singular.indexOf(':');
    // We compare against 0 instead of -1 because we don't really expect the string to start with ':'.
    if (0 < indexOfColon) {
      defaultSingular = singular.substring(indexOfColon + 1);
      singular = singular.substring(0, indexOfColon);
    }
    if (plural && typeof plural !== 'number') {
      indexOfColon = plural.indexOf(':');
      if (0 < indexOfColon) {
        defaultPlural = plural.substring(indexOfColon + 1);
        plural = plural.substring(0, indexOfColon);
      }
    }
  }

  var accessor = localeAccessor(locale, singular);
  var mutator = localeMutator(locale, singular);

  if (plural) {
    if (!accessor()) {
      // when retryInDefaultLocale is true - try to set default value from defaultLocale
      if (i18n.options.retryInDefaultLocale && locale != i18n.options.defaultLocale) {
        logDebug("Missing " + singular + " in " + locale + " retrying in " + i18n.options.defaultLocale);
        mutator(translate(i18n.options.defaultLocale, singular, plural));
      } else {
        mutator({
          'one': defaultSingular || singular,
          'other': defaultPlural || plural
        });
      }
      write(locale);
    }
  }

  if (!accessor()) {
    // when retryInDefaultLocale is true - try to set default value from defaultLocale
    if (i18n.options.retryInDefaultLocale && locale != i18n.options.defaultLocale) {
      logDebug("Missing " + singular + " in " + locale + " retrying in " + i18n.options.defaultLocale);
      mutator(translate(i18n.options.defaultLocale, singular, plural));
    } else {
      mutator(defaultSingular || singular);
    }
    write(locale);
  }

  return accessor();
}

/**
 * Allows delayed access to translations nested inside objects.
 * @param {String} locale The locale to use.
 * @param {String} singular The singular term to look up.
 * @param {Boolean} [allowDelayedTraversal=true] Is delayed traversal of the tree allowed?
 * This parameter is used internally. It allows to signal the accessor that
 * a translation was not found in the initial lookup and that an invocation
 * of the accessor may trigger another traversal of the tree.
 * @returns {Function} A function that, when invoked, returns the current value stored
 * in the object at the requested location.
 */
function localeAccessor(locale, singular, allowDelayedTraversal) {
  // Bail out on non-existent locales to defend against internal errors.
  if (!locales[locale]) return Function.prototype;

  // Handle object lookup notation
  var indexOfDot = i18n.options.objectNotation && singular.indexOf(i18n.options.objectNotation);
  if (i18n.options.objectNotation && (0 < indexOfDot && indexOfDot < singular.length)) {
    // If delayed traversal wasn't specifically forbidden, it is allowed.
    if (typeof allowDelayedTraversal == "undefined") allowDelayedTraversal = true;
    // The accessor we're trying to find and which we want to return.
    var accessor = null;
    // An accessor that returns null.
    var nullAccessor = function() {
      return null;
    };
    // Do we need to re-traverse the tree upon invocation of the accessor?
    var reTraverse = false;
    // Split the provided term and run the callback for each subterm.
    singular.split(i18n.options.objectNotation).reduce(function(object, index) {
      // Make the accessor return null.
      accessor = nullAccessor;
      // If our current target object (in the locale tree) doesn't exist or
      // it doesn't have the next subterm as a member...
      if (null === object || !object.hasOwnProperty(index)) {
        // ...remember that we need retraversal (because we didn't find our target).
        reTraverse = allowDelayedTraversal;
        // Return null to avoid deeper iterations.
        return null;
      }
      // We can traverse deeper, so we generate an accessor for this current level.
      accessor = function() {
        return object[index];
      };
      // Return a reference to the next deeper level in the locale tree.
      return object[index];

    }, locales[locale]);
    // Return the requested accessor.
    return function() {
      // If we need to re-traverse (because we didn't find our target term)
      // traverse again and return the new result (but don't allow further iterations)
      // or return the previously found accessor if it was already valid.
      return (reTraverse) ? localeAccessor(locale, singular, false)() : accessor();
    };

  } else {
    // No object notation, just return an accessor that performs array lookup.
    return function() {
      return locales[locale][singular];
    };
  }
}

/**
 * Allows delayed mutation of a translation nested inside objects.
 * @description Construction of the mutator will attempt to locate the requested term
 * inside the object, but if part of the branch does not exist yet, it will not be
 * created until the mutator is actually invoked. At that point, re-traversal of the
 * tree is performed and missing parts along the branch will be created.
 * @param {String} locale The locale to use.
 * @param {String} singular The singular term to look up.
 * @param [Boolean} [allowBranching=false] Is the mutator allowed to create previously
 * non-existent branches along the requested locale path?
 * @returns {Function} A function that takes one argument. When the function is
 * invoked, the targeted translation term will be set to the given value inside the locale table.
 */
function localeMutator(locale, singular, allowBranching) {
  // Bail out on non-existent locales to defend against internal errors.
  if (!locales[locale]) return Function.prototype;

  // Handle object lookup notation
  var indexOfDot = i18n.options.objectNotation && singular.indexOf(i18n.options.objectNotation);
  if (i18n.options.objectNotation && (0 < indexOfDot && indexOfDot < singular.length)) {
    // If branching wasn't specifically allowed, disable it.
    if (typeof allowBranching == "undefined") allowBranching = false;
    // This will become the function we want to return.
    var accessor = null;
    // An accessor that takes one argument and returns null.
    var nullAccessor = function() {
      return null;
    };
    // Are we going to need to re-traverse the tree when the mutator is invoked?
    var reTraverse = false;
    // Split the provided term and run the callback for each subterm.
    singular.split(i18n.options.objectNotation).reduce(function(object, index) {
      // Make the mutator do nothing.
      accessor = nullAccessor;
      // If our current target object (in the locale tree) doesn't exist or
      // it doesn't have the next subterm as a member...
      if (null === object || !object.hasOwnProperty(index)) {
        // ...check if we're allowed to create new branches.
        if (allowBranching) {
          // If we are allowed to, create a new object along the path.
          object[index] = {};
        } else {
          // If we aren't allowed, remember that we need to re-traverse later on and...
          reTraverse = true;
          // ...return null to make the next iteration bail our early on.
          return null;
        }
      }
      // Generate a mutator for the current level.
      accessor = function(value) {
        object[index] = value;
        return value;
      };

      // Return a reference to the next deeper level in the locale tree.
      return object[index];

    }, locales[locale]);

    // Return the final mutator.
    return function(value) {
      // If we need to re-traverse the tree
      // invoke the search again, but allow branching this time (because here the mutator is being invoked)
      // otherwise, just change the value directly.
      return (reTraverse) ? localeMutator(locale, singular, true)(value) : accessor(value);
    };

  } else {
    // No object notation, just return a mutator that performs array lookup and changes the value.
    return function(value) {
      locales[locale][singular] = value;
      return value;
    };
  }
}

/**
 * try reading a file
 */

function read(locale) {
  var localeFile = {},
    file = getStorageFilePath(locale);
  try {
    logDebug('read ' + file + ' for locale: ' + locale);
    localeFile = fs.readFileSync(file);
    try {
      // parsing filecontents to locales[locale]
      locales[locale] = i18n.deserializeLocale(localeFile);
    } catch (parseError) {
      logError('unable to parse locales from file (maybe ' + file + ' is empty or invalid json?): ', parseError);
    }
  } catch (readError) {
    // unable to read, so intialize that file
    // locales[locale] are already set in memory, so no extra read required
    // or locales[locale] are empty, which initializes an empty locale.json file

    // since the current invalid locale could exist, we should back it up
    if (fs.existsSync(file)) {
      logDebug('backing up invalid locale ' + locale + ' to ' + file + '.invalid');
      fs.renameSync(file, file + '.invalid');
    }

    logDebug('initializing ' + file);
    write(locale);
  }
}

/**
 * try writing a file in a created directory
 */

function write(locale) {
  var stats, target, tmp;

  // don't write new locale information to disk if updateFiles isn't true
  if (!i18n.options.updateFiles) {
    return;
  }

  // creating directory if necessary
  try {
    stats = fs.lstatSync(i18n.options.directory);
  } catch (e) {
    logDebug('creating locales dir in: ' + i18n.options.directory);
    fs.mkdirSync(i18n.options.directory, i18n.options.directoryPermissions);
  }

  // first time init has an empty file
  if (!locales[locale]) {
    locales[locale] = {};
  }

  // writing to tmp and rename on success
  try {
    target = getStorageFilePath(locale);
    tmp = target + ".tmp";
    var serialized = i18n.serializeLocale(locales[locale]);
    fs.writeFileSync(tmp, serialized, "utf8");
    stats = fs.statSync(tmp);
    if (stats.isFile()) {
      fs.renameSync(tmp, target);
    } else {
      logError('unable to write locales to file (either ' + tmp + ' or ' + target + ' are not writeable?): ');
    }
  } catch (e) {
    logError('unexpected error writing files (either ' + tmp + ' or ' + target + ' are not writeable?): ', e);
  }
}

/**
 * basic normalization of filepath
 */

function getStorageFilePath(locale) {
  // changed API to use .json as default, #16
  var ext = i18n.options.extension || '.json',
    filepath = path.normalize(i18n.options.directory + pathsep + i18n.options.prefix + locale + ext),
    filepathJS = path.normalize(i18n.options.directory + pathsep + i18n.options.prefix + locale + '.js');
  // use .js as fallback if already existing
  try {
    if (fs.statSync(filepathJS)) {
      logDebug('using existing file ' + filepathJS);
      i18n.options.extension = '.js';
      return filepathJS;
    }
  } catch (e) {
    logDebug('will use ' + filepath);
  }
  return filepath;
}

/**
 * Logging proxies
 */

function logDebug(msg) {
  i18n.options.logDebugFn(msg);
}

function logWarn(msg) {
  i18n.options.logWarnFn(msg);
}

function logError(msg) {
  i18n.options.logErrorFn(msg);
}