// broken — test fixture: doesn't parse
(
params: [[\note, 60, \note]],
run: { |g, p| loop { ~strike.(g, p[\note] 80); 0.25.wait } },
)
