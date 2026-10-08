// wander — test fixture: an AdHoc type that drives settings (maps: true): a slow random walk
(
params: [[\speed, 4, \range, 0.1, 20, 0.1]],
output: false,
maps: true,
run: { |g, p|
	var x = 0.5;
	~tick.({ |seconds, beats|
		x = (x + (p[\speed] * 0.02).rand2).fold(0, 1);
		~drive.(g, x);
	});
},
)
