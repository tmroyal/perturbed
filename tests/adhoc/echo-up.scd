// echo-up — test fixture: its note on every quarter beat
(
params: [[\note, 60, \note]],
run: { |g, p| loop { ~strike.(g, p[\note].asInteger, 80); 0.25.wait } },
)
