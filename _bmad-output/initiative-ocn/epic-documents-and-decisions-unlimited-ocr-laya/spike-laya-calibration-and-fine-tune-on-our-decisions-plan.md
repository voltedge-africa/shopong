---
title: "Spike: Laya calibration and fine-tune on our decisions"
ticket: 4
status: draft
---

## Story and acceptance criteria

As a builder,
I want to learn whether Laya meets our accuracy and calibration bar on our own data,
So that we only use it where it is reliable.

**Acceptance Criteria:**

**Given** a labelled sample of quote-ranking, document-type and consistency decisions  
**When** I compare base, `multilingual` and a fine-tuned checkpoint against the majority-class baseline  
**Then** I record accuracy, expected calibration error after temperature refit and the confidence threshold for each question.  

**Given** the findings  
**When** a question does not beat the baseline  
**Then** it is not shipped and stays a human decision.  
