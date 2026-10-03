// live-grid — test fixture: a note per grid step, the step read live (no restartOn)
(
params: [[\step, 0.25, \range, 0.0625, 4, 0.0625]],
run: { |g, p| ~grid.({ p[\step] }, { |k| ~strike.(g, 60, 80) }) },
)
