// crashy — test fixture: plays once, then fails while running
(
params: [[\note, 60, \note]],
run: { |g, p| ~strike.(g, 60, 80); 0.25.wait; nil.noSuchMethod },
)
