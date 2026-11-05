"""AI assistant: the parts that don't touch the network.

The user brings the model (Claude, OpenAI, or any OpenAI-compatible server
such as Ollama, LM Studio or llama.cpp). This package holds the provider
config, the instructions sent to the model and the compiler that turns what
the model writes into engine payloads. The HTTP calls live in
`wp_api/_ai_client.py`, so this package stays importable in plain pytest.

The model never writes engine payloads itself. It writes a small, name-based
spec; `engine.ai.wildcard` (and its siblings as more module types arrive)
assigns ids, sanitizes tags, drops duplicates and runs the result through the
module's own `validate_payload` before anything reaches the editor.
"""
