"""Language-ID backends.

The rest of the service only depends on the ``Identifier`` protocol, so a
new model is a change to this file alone.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np

# What a model's labels mean. MMS-LID returns ISO 639-3 codes; LAMP returns
# GRN language IDs.
LabelKind = Literal["iso639_3", "grn_language_id"]


@dataclass(frozen=True)
class LabelScore:
    label: str
    score: float  # model probability, 0..1


class Identifier(Protocol):
    name: str
    label_kind: LabelKind

    def identify(self, samples: np.ndarray, sample_rate: int, limit: int) -> list[LabelScore]:
        """Return up to ``limit`` labels, best first. Return the long tail, not a
        top 5: location narrowing and "No → next candidate" both need it."""
        ...


class StubIdentifier:
    """Returns a fixed ranking so the UI can be built without a model or GPU."""

    name = "stub"
    label_kind: LabelKind = "iso639_3"

    def __init__(self, labels: list[str]):
        if not labels:
            raise ValueError("stub identifier needs at least one label")
        weights = [0.5**i for i in range(len(labels))]
        total = sum(weights)
        self._scores = [LabelScore(label, w / total) for label, w in zip(labels, weights)]

    def identify(self, samples: np.ndarray, sample_rate: int, limit: int) -> list[LabelScore]:
        return self._scores[:limit]


class MmsIdentifier:
    """Meta's MMS-LID model, the one the 2025 prototype used.

    The default until LAMP has more training data (docs/rethink.md, item 1).
    Its labels are ISO codes, so each guess expands to every GRN variety with
    that code (item 3). Downloads a few GB from Hugging Face on first run.
    """

    label_kind: LabelKind = "iso639_3"

    def __init__(self, model_id: str = "facebook/mms-lid-4017"):
        import torch
        from transformers import AutoFeatureExtractor, Wav2Vec2ForSequenceClassification

        self.name = f"mms:{model_id}"
        self._torch = torch
        if torch.cuda.is_available():
            self._device = torch.device("cuda")
        elif torch.backends.mps.is_available():
            self._device = torch.device("mps")
        else:
            self._device = torch.device("cpu")
        self._processor = AutoFeatureExtractor.from_pretrained(model_id)
        self._model = Wav2Vec2ForSequenceClassification.from_pretrained(model_id).to(self._device)
        self._model.eval()

    def identify(self, samples: np.ndarray, sample_rate: int, limit: int) -> list[LabelScore]:
        torch = self._torch
        inputs = self._processor(samples, sampling_rate=sample_rate, return_tensors="pt")
        inputs = {k: v.to(self._device) for k, v in inputs.items()}
        with torch.no_grad():
            probs = torch.softmax(self._model(**inputs).logits, dim=-1)[0]
        top = torch.topk(probs, k=min(limit, probs.numel()))
        id2label = self._model.config.id2label
        return [LabelScore(id2label[i.item()], p.item()) for p, i in zip(top.values, top.indices)]


class IdentifierError(RuntimeError):
    """The model could not be reached or returned something unusable."""


class LampIdentifier:
    """GRN's LAMP model, called over HTTP.

    LAMP runs as its own server (``lid_finetune/scripts/model/serve.py`` in the
    LAMP repo), in its own Python environment. That keeps its heavy
    dependencies (PyTorch builds for CUDA, peft, TensorFlow) out of this
    service, and lets it run on a separate GPU machine. See README, "Running
    with LAMP".

    LAMP's labels are GRN language IDs, so each one names a single language
    or variety. Label 0 means "no linguistic content"; it and other labels the
    catalog doesn't have come back as ``unmapped_labels``.
    """

    label_kind: LabelKind = "grn_language_id"
    # serve.py rejects top_k above 50.
    MAX_TOP_K = 50

    def __init__(self, url: str, timeout: float = 120.0, transport=None):
        import httpx

        self.name = f"lamp:{url}"
        self._client = httpx.Client(base_url=url, timeout=timeout, transport=transport)

    def identify(self, samples: np.ndarray, sample_rate: int, limit: int) -> list[LabelScore]:
        import httpx

        from .audio import to_wav_bytes

        top_k = max(1, min(limit, self.MAX_TOP_K))
        try:
            resp = self._client.post(
                "/predict",
                params={"top_k": top_k},
                files={"file": ("clip.wav", to_wav_bytes(samples, sample_rate), "audio/wav")},
            )
        except httpx.HTTPError as e:
            raise IdentifierError(f"LAMP server not reachable at {self._client.base_url}: {e}") from e
        if resp.status_code != 200:
            raise IdentifierError(f"LAMP server returned {resp.status_code}: {resp.text[:200]}")
        try:
            predictions = resp.json()["predictions"]
            return [LabelScore(str(p["id"]), float(p["probability"])) for p in predictions]
        except (ValueError, KeyError, TypeError) as e:
            raise IdentifierError(f"unexpected response from LAMP server: {e}") from e


def make_identifier(name: str, stub_labels: str = "", lamp_url: str = "") -> Identifier:
    if name == "stub":
        return StubIdentifier([s.strip() for s in stub_labels.split(",") if s.strip()])
    if name == "mms":
        return MmsIdentifier()
    if name == "lamp":
        return LampIdentifier(lamp_url)
    raise ValueError(f"unknown identifier {name!r}; expected stub, mms or lamp")
