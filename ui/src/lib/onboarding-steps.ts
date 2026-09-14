/**
 * Which of the wizard's first two screens asks which question.
 *
 * Building a new organization asks the mission first and the name second: the
 * mission is the question a person arrives with an answer to, and naming is
 * easier once they have just written down what the team is for. Growing an
 * existing team keeps the name first, because that path has no mission screen
 * to put ahead of it.
 *
 * The step *numbers* never move. Step 1 is "the first question" and step 2 is
 * "the second" on both paths, so a wizard resumed from saved localStorage
 * state lands at the same place in the flow, and the stepper's jump rules do
 * not have to know any of this.
 */
export type OnboardingPath = "create" | "grow" | null;

export type OnboardingQuestionSteps = {
  /** True for the create path, and for a wizard opened without one. */
  buildsNewOrganization: boolean;
  /** The step that asks for the mission, or null when the path has none. */
  missionStep: 1 | null;
  /** The step that asks for the organization's name. */
  nameStep: 1 | 2;
};

export function onboardingQuestionSteps(path: OnboardingPath): OnboardingQuestionSteps {
  // A wizard opened straight onto the questions — no front door, which is what
  // happens on an instance with no organizations — is building a new one.
  const buildsNewOrganization = path !== "grow";
  return {
    buildsNewOrganization,
    missionStep: buildsNewOrganization ? 1 : null,
    nameStep: buildsNewOrganization ? 2 : 1,
  };
}
