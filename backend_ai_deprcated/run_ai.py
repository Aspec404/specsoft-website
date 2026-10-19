
import os
import json
from pathlib import Path

# Keep CPU usage reasonable for your Intel i3.
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import torch
import torch.nn as nn
import torch.nn.functional as F


# ============================================================
# SPECTRA SPECTRUM 1.0 | LOCAL INFERENCE ENGINE
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

WEIGHTS_PATH = BASE_DIR / "ultimate_genius_model_weights.pth"
VOCAB_PATH = BASE_DIR / "spectrum_vocab.json"

DEVICE = torch.device("cpu")
BLOCK_SIZE = 32
N_EMBD = 64
N_HEAD = 4
N_LAYER = 3

TEMPERATURE = 0.8
MAX_NEW_TOKENS = 250

torch.set_num_threads(1)
torch.manual_seed(42)


# ============================================================
# VOCABULARY
# Must match the vocabulary used during training EXACTLY.
# ============================================================

def load_vocabulary():
    if not VOCAB_PATH.exists():
        raise FileNotFoundError(
            f"Missing vocabulary file: {VOCAB_PATH.name}\n"
            "Export the exact training vocabulary to this file."
        )

    with VOCAB_PATH.open("r", encoding="utf-8") as file:
        chars = json.load(file)

    if not isinstance(chars, list) or not chars:
        raise ValueError("Vocabulary must be a non-empty JSON list.")

    if not all(isinstance(ch, str) and len(ch) == 1 for ch in chars):
        raise ValueError(
            "Expected a list of single characters in the vocabulary."
        )

    if len(set(chars)) != len(chars):
        raise ValueError("Vocabulary contains duplicate characters.")

    return chars


# ============================================================
# TRANSFORMER ARCHITECTURE
# Must match the training architecture exactly.
# ============================================================

class LocalHead(nn.Module):
    def __init__(self, head_size):
        super().__init__()

        self.key = nn.Linear(N_EMBD, head_size, bias=False)
        self.query = nn.Linear(N_EMBD, head_size, bias=False)
        self.value = nn.Linear(N_EMBD, head_size, bias=False)

        self.register_buffer(
            "tril",
            torch.tril(torch.ones(BLOCK_SIZE, BLOCK_SIZE))
        )

    def forward(self, x):
        _, T, _ = x.shape

        k = self.key(x)
        q = self.query(x)

        scores = q @ k.transpose(-2, -1)
        scores = scores * (k.shape[-1] ** -0.5)

        scores = scores.masked_fill(
            self.tril[:T, :T] == 0,
            float("-inf")
        )

        weights = F.softmax(scores, dim=-1)
        return weights @ self.value(x)


class LocalMultiHead(nn.Module):
    def __init__(self, num_heads, head_size):
        super().__init__()

        self.heads = nn.ModuleList([
            LocalHead(head_size) for _ in range(num_heads)
        ])

        self.proj = nn.Linear(N_EMBD, N_EMBD)

    def forward(self, x):
        out = torch.cat([head(x) for head in self.heads], dim=-1)
        return self.proj(out)


class LocalFeedForward(nn.Module):
    def __init__(self):
        super().__init__()

        self.net = nn.Sequential(
            nn.Linear(N_EMBD, 4 * N_EMBD),
            nn.ReLU(),
            nn.Linear(4 * N_EMBD, N_EMBD),
        )

    def forward(self, x):
        return self.net(x)


class LocalBlock(nn.Module):
    def __init__(self):
        super().__init__()

        self.sa = LocalMultiHead(
            N_HEAD,
            N_EMBD // N_HEAD
        )

        self.ffwd = LocalFeedForward()

        self.ln1 = nn.LayerNorm(N_EMBD)
        self.ln2 = nn.LayerNorm(N_EMBD)

    def forward(self, x):
        x = x + self.sa(self.ln1(x))
        x = x + self.ffwd(self.ln2(x))
        return x


class SpectrumModel(nn.Module):
    def __init__(self, vocab_size):
        super().__init__()

        self.token_embedding_table = nn.Embedding(
            vocab_size, N_EMBD
        )

        self.position_embedding_table = nn.Embedding(
            BLOCK_SIZE, N_EMBD
        )

        self.blocks = nn.Sequential(*[
            LocalBlock() for _ in range(N_LAYER)
        ])

        self.ln_f = nn.LayerNorm(N_EMBD)
        self.lm_head = nn.Linear(N_EMBD, vocab_size)

    def forward(self, idx):
        _, T = idx.shape

        tok_emb = self.token_embedding_table(idx)

        pos = torch.arange(T, device=idx.device)
        pos_emb = self.position_embedding_table(pos)

        x = tok_emb + pos_emb
        x = self.blocks(x)
        x = self.ln_f(x)

        return self.lm_head(x)

    @torch.no_grad()
    def generate(
        self,
        idx,
        max_new_tokens=250,
        temperature=0.8
    ):
        if temperature <= 0:
            raise ValueError("Temperature must be greater than zero.")

        for _ in range(max_new_tokens):
            idx_cond = idx[:, -BLOCK_SIZE:]

            logits = self(idx_cond)
            logits = logits[:, -1, :] / temperature

            probs = F.softmax(logits, dim=-1)

            if not torch.isfinite(probs).all():
                raise RuntimeError(
                    "Invalid sampling probabilities. Check the model."
                )

            next_token = torch.multinomial(probs, num_samples=1)
            idx = torch.cat((idx, next_token), dim=1)

        return idx


# ============================================================
# INITIALIZATION
# ============================================================

def main():
    print("\n" + "=" * 52)
    print("       SPECTRA | SPECTRUM 1.0")
    print("       Local AI Inference Engine")
    print("=" * 52)

    if not WEIGHTS_PATH.exists():
        print(f"\nERROR: Missing model weights: {WEIGHTS_PATH.name}")
        return

    try:
        chars = load_vocabulary()

        char_to_id = {ch: i for i, ch in enumerate(chars)}
        id_to_char = {i: ch for i, ch in enumerate(chars)}

        # Only load checkpoints you trust. weights_only=True restricts
        # deserialization to supported safe objects in modern PyTorch.
        try:
            state = torch.load(
                WEIGHTS_PATH,
                map_location=DEVICE,
                weights_only=True
            )
        except TypeError:
            raise RuntimeError(
                "Your PyTorch version lacks weights_only support. "
                "Upgrade PyTorch before loading this checkpoint."
            )

        # Support either a raw state_dict or a checkpoint dictionary.
        if isinstance(state, dict) and "model_state_dict" in state:
            state = state["model_state_dict"]

        if not isinstance(state, dict):
            raise ValueError("Checkpoint is not a valid state dictionary.")

        model = SpectrumModel(vocab_size=len(chars))
        model.load_state_dict(state, strict=True)
        model.to(DEVICE)
        model.eval()

        print(f"\nDevice: {DEVICE}")
        print(f"Vocabulary size: {len(chars)}")
        print("Model weights loaded successfully.")
        print("\nType a prompt to talk to Spectrum.")
        print("Type /quit to exit.")

        while True:
            prompt = input("\nYou: ").strip()

            if prompt.lower() == "/quit":
                print("Spectrum: Goodbye! See you next time.")
                break

            if not prompt:
                continue

            # Character-level models cannot encode unknown characters.
            unknown = sorted(set(prompt) - set(char_to_id))

            if unknown:
                print(
                    "Spectrum: Your prompt contains characters "
                    f"outside my vocabulary: {unknown}"
                )
                continue

            # This format only works well if similar prompt patterns
            # were represented in the model's training data.
            input_ids = [char_to_id[ch] for ch in prompt]

            context = torch.tensor(
                [input_ids[-BLOCK_SIZE:]],
                dtype=torch.long,
                device=DEVICE
            )

            output = model.generate(
                context,
                max_new_tokens=MAX_NEW_TOKENS,
                temperature=TEMPERATURE
            )[0].tolist()

            # Print only newly generated characters.
            generated_ids = output[len(context[0]):]
            response = "".join(
                id_to_char[token_id] for token_id in generated_ids
            )

            print(f"\nSpectra: {response}")

    except (FileNotFoundError, ValueError, RuntimeError, KeyError) as exc:
        print(f"\nERROR: {exc}")
        print(
            "\nCheck that your vocabulary, model architecture, "
            "and checkpoint all match your training setup."
        )


if __name__ == "__main__":
    main()
