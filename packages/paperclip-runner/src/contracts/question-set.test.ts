import { describe, expect, it } from "vitest";

import {
  PAPERCLIP_QUESTION_RESPONSE_SCHEMA,
  PAPERCLIP_QUESTION_SET_SCHEMA,
  parseToderoQuestionResponse,
  parseToderoQuestionSet,
  type ToderoQuestionSet,
} from "./question-set.js";

const questionSet: ToderoQuestionSet = {
  schema: PAPERCLIP_QUESTION_SET_SCHEMA,
  title: "Release input",
  questions: [
    {
      id: "environment",
      prompt: "Where should we deploy?",
      required: true,
      answerMode: "single_select",
      options: [
        { id: "staging", label: "Staging" },
        { id: "production", label: "Production" },
      ],
      customAnswer: { enabled: true, label: "Other" },
    },
    {
      id: "replicas",
      prompt: "How many replicas?",
      required: true,
      answerMode: "text",
      textValidation: { inputType: "integer", minimum: 1, maximum: 20 },
    },
  ],
};

describe("Todero question-set contract", () => {
  it("round-trips the portable presentation model", () => {
    expect(parseToderoQuestionSet(questionSet)).toEqual(questionSet);
    expect(
      parseToderoQuestionResponse(questionSet, {
        schema: PAPERCLIP_QUESTION_RESPONSE_SCHEMA,
        answers: {
          environment: { selectedOptionIds: ["staging"] },
          replicas: { text: "3" },
        },
      }),
    ).toEqual({
      schema: PAPERCLIP_QUESTION_RESPONSE_SCHEMA,
      answers: {
        environment: { selectedOptionIds: ["staging"] },
        replicas: { text: "3" },
      },
    });
  });

  it("rejects missing, unknown, and provider-shaped answers", () => {
    expect(() =>
      parseToderoQuestionResponse(questionSet, {
        schema: PAPERCLIP_QUESTION_RESPONSE_SCHEMA,
        answers: {
          environment: { selectedOptionIds: ["unknown"] },
          replicas: { text: "3" },
        },
      }),
    ).toThrow(/unknown option/);
    expect(() =>
      parseToderoQuestionResponse(questionSet, {
        schema: PAPERCLIP_QUESTION_RESPONSE_SCHEMA,
        answers: { environment: { selectedOptionIds: ["staging"] } },
      }),
    ).toThrow(/replicas.*required/);
    expect(() =>
      parseToderoQuestionResponse(questionSet, {
        answers: { environment: { answers: ["Staging"] } },
      }),
    ).toThrow(/todero.question_response.v1/);
    expect(() =>
      parseToderoQuestionResponse(questionSet, {
        schema: PAPERCLIP_QUESTION_RESPONSE_SCHEMA,
        answers: {
          environment: { answers: ["Staging"] },
          replicas: { text: "3" },
        },
      }),
    ).toThrow(/canonical response contract/);
  });

  it("applies typed numeric validation before an adapter sees the answer", () => {
    expect(() =>
      parseToderoQuestionResponse(questionSet, {
        schema: PAPERCLIP_QUESTION_RESPONSE_SCHEMA,
        answers: {
          environment: { customText: "Canary" },
          replicas: { text: "3.5" },
        },
      }),
    ).toThrow(/valid integer/);
    expect(() =>
      parseToderoQuestionResponse(questionSet, {
        schema: PAPERCLIP_QUESTION_RESPONSE_SCHEMA,
        answers: {
          environment: { customText: "Canary" },
          replicas: { text: "21" },
        },
      }),
    ).toThrow(/at most 20/);
  });
});
