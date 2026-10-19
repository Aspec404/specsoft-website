
import json
from pathlib import Path

# IMPORTANT:
# Replace this example list with the EXACT dataset_chars
# list from your original training script.
dataset_chars = [
    '\n', ' ', '!', "'", ',', '-', '.', ':', ';', '?',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'A', 'B', 'C', 'D', 'F', 'G', 'H', 'I', 'J', 'K',
    'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'
]

vocab_path = Path(__file__).resolve().parent / "spectrum_vocab.json"

# Preserve the original order exactly.
with vocab_path.open("w", encoding="utf-8") as file:
    json.dump(dataset_chars, file, ensure_ascii=True, indent=2)

print(f"Vocabulary saved to: {vocab_path}")
print(f"Character count: {len(dataset_chars)}")
print("Vocabulary:", repr(dataset_chars))
