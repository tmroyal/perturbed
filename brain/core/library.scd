// library.scd — every generator type the brain knows (PLAN §1.1): built-in (brain/types/) and AdHoc
// (adhoc/ at the repo root, written by Claude for a piece; $PERFORMED_ADHOC elsewhere, for tests).
// A type file evaluates to an Event (see core/generators.scd); its first line says what it is:
//   // rolling-strum — strums the chord upward, spread in beats
//
// Favorites (adhoc/favorites.json; default: the built-ins) load at boot and are the add bar; other
// types load on demand (/adhoc/load) and join the bar for the session. Loading is hot and guarded:
// a file that fails to evaluate changes nothing and is reported (/error). Reloading a type moves its
// generators to the new version, keeping their settings; the replaced AdHoc source is kept in
// adhoc/old/. ~typeSource holds what's loaded, which performance files embed (core/persist.scd).
(
~adhocDir = "PERFORMED_ADHOC".getenv ?? { ~root.dirname +/+ "adhoc" };
~library = ();          // name -> (name, path, builtin, description)
~types = ();            // the loaded types: name -> type Event
~typeSource = ();       // name -> the source loaded
~sessionTypes = Set[];  // loaded this session without being favorites: on the add bar until restart
~favorites = [];

~describe = { |path|
	var first = (File.readAllString(path).split($\n).first ? "");
	var i = first.find(" — ");
	if(i.notNil) { first[(i + " — ".size)..].stripWhiteSpace } { "" };  // (the dash is 3 bytes)
};

~scanLibrary = {
	~library = ();
	[[~root +/+ "types", true], [~adhocDir, false]].do { |pair|
		(pair[0] +/+ "*.scd").pathMatch.do { |path|
			var name = path.basename.splitext[0].asSymbol;
			if(~library[name].notNil) { "adhoc type % ignored: a built-in has that name".format(name).warn } {
				~library[name] = (name: name, path: path, builtin: pair[1], description: ~describe.(path));
			};
		};
	};
};

~favoritesPath = { ~adhocDir +/+ "favorites.json" };
~readFavorites = {
	var path = ~favoritesPath.();
	~favorites = if(File.exists(path)) {
		(File.readAllString(path).parseJSON ? []).collect(_.asSymbol)
	} { ~library.values.select(_[\builtin]).collect(_[\name]) };
};
~writeFavorites = {
	File.mkdir(~adhocDir);
	~writeJSON.(~favoritesPath.(), ~favorites.collect(_.asString).sort);
};

~setFavorite = { |name, on|
	name = name.asSymbol;
	if(~library[name].isNil) { ~send.('/error', "no type % in the library".format(name)) } {
		~favorites = ~favorites.reject(_ == name) ++ (if(on) { [name] } { [] });
		~writeFavorites.();
		if(on and: { ~types[name].isNil }) { ~loadType.(name) };
		~sendState.();
	};
};

// Loads (or reloads) a type from its library file, or from `source` (a piece's embedded copy).
// Returns true if it loaded.
~loadType = { |name, source|
	var entry, type, err;
	name = name.asSymbol;
	entry = ~library[name];
	source = source ?? { entry !? { File.readAllString(entry[\path]) } };
	case
	{ source.isNil } { err = "there's no type % in the library".format(name) }
	{ (type = try { source.interpret } { |e| err = e.errorString; nil }).isNil } {
		err = err ? "it has a syntax error (sclang's message is in the brain's log)";
	}
	{ type.isKindOf(Event).not or: { type[\params].isNil } } { err = "it must evaluate to an Event with params" }
	{ type[\run].isNil and: { type[\key].isNil } } { err = "it needs a run or a key function" };
	if(err.notNil) {
		"type % didn't load: %".format(name, err).warn;
		~send.('/error', "type % didn't load: %".format(name, err));
		false;
	} {
		// keep the AdHoc version being replaced
		if((entry.isNil or: { entry[\builtin].not }) and: { ~typeSource[name].notNil } and: { ~typeSource[name] != source }) {
			File.mkdir(~adhocDir +/+ "old");
			File.use(~adhocDir +/+ "old" +/+ "%-%.scd".format(name, Date.getDate.stamp), "w", { |f| f.write(~typeSource[name]) });
		};
		~types[name] = type;
		~typeSource[name] = source;
		~gens.do { |g| if(g[\typeName] == name) { ~retype.(g, type) } };
		true;
	};
};

// A generator moves to a new version of its type: settings kept where the param still exists.
~retype = { |g, type|
	var old = g[\p];
	g[\type] = type;
	g[\p] = ();
	type[\params].do { |spec| g[\p][spec[0]] = old[spec[0]] ? spec[1] };
	if(g[\task].notNil) { ~startGen.(g) };
};

// A generator's type failed while running (run or key): it stops, and the error is reported.
~genFailed = { |g, e|
	"generator % (%) stopped: %".format(g[\id], g[\typeName], e.errorString).warn;
	~send.('/error', "generator % (%) stopped: %".format(g[\id], g[\typeName], e.errorString));
	g[\task] = nil;
	g[\active] = false;
	~release.(g); ~releaseHeld.(g);
	~sendGen.(g);
};

~libraryInit = {
	~scanLibrary.();
	~readFavorites.();
	~favorites.do { |name| if(~library[name].notNil) { ~loadType.(name) } };
};

// on the add bar: favorites, and types loaded this session
~onBar = { |name| ~types[name].notNil and: { ~favorites.includes(name) or: { ~sessionTypes.includes(name) } } };

~sendLibrary = {
	~library.keys.asArray.sort.do { |name|
		var e = ~library[name];
		var changed = ~typeSource[name].notNil and: { ~typeSource[name] != File.readAllString(e[\path]) };
		~send.('/library/type', name, e[\builtin].binaryValue, ~favorites.includes(name).binaryValue,
			~types[name].notNil.binaryValue, ~onBar.(name).binaryValue, changed.binaryValue, e[\description]);
	};
};
)
