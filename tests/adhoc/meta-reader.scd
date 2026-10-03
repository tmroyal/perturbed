// meta-reader — test fixture: plays 60 plus an octave times the global `depth`
(
params: [[\vel, 80, \range, 1, 127]],
globals: [\depth],
run: { |g, p| loop { ~strike.(g, 60 + (~global.(\depth) * 12).round.asInteger, 80); 0.25.wait } },
)
