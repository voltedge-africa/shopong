---
id: 4
type: spike
title: "Laya calibration and fine-tune on our decisions"
parent: epic-documents-and-decisions-unlimited-ocr-laya
covers: [FR8, AR3]
after: []
refined: false
hitl: false
risk: high
---

# Laya calibration and fine-tune on our decisions

## Description

Tests whether Laya beats the majority-class baseline on our own labelled decisions after calibration and fine-tuning, question by question, so that questions that do not beat the baseline stay human decisions.

As a builder,  
I want to learn whether Laya meets our accuracy and calibration bar on our own data,  
So that we only use it where it is reliable.

## Acceptance Criteria

1. **Given** a labelled sample of quote-ranking, document-type and consistency decisions
   **When** I compare base, `multilingual` and a fine-tuned checkpoint against the majority-class baseline
   **Then** I record accuracy, expected calibration error after temperature refit and the confidence threshold for each question.
2. **Given** the findings
   **When** a question does not beat the baseline
   **Then** it is not shipped and stays a human decision.

## References

- parent — _bmad-output/initiative-ocn/epic-documents-and-decisions-unlimited-ocr-laya/epic-documents-and-decisions-unlimited-ocr-laya.md
- architecture-ocn/architecture-ocn.md#system-1-decision-model-via-laya
