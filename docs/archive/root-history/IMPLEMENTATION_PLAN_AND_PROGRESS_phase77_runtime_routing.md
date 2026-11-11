Phase 77 — Runtime Routing and Diagnostics

Implemented

Added execution foundation metadata for layers.

Added runtime engine override policy per layer.

Added diagnostics overlay in App.

Added execution engine selectors to Layer 2 / Layer 3 tabs.

Added diagnostics toggles to the global display panel.

Moved AppScene particle/procedural routing onto resolved runtime engine decisions.

Why this matters

This is the first step where runtime rendering decisions and the visible control surface share the same execution foundation. Later engines can now enter through one decision path instead of branching UI and runtime separately.
