/**
 * Which of the wizard's first two screens asks which question.
 *
 * Building a new organization asks the mission first and the name second: the
 * mission is the question a person arrives with an answer to, and naming is
 * easier once they have just written down what the team is for. Growing an
 * existing team keeps the name first, because that path has no mission screen
 * to put ahead of it.
 *
 * A run the app drops straight onto step 2 is not building anything: that is
 * how an existing company is sent to collect its mission, and there is no name
 * left to ask for. Such a run keeps the original order, so the step it was
 * sent to is still the screen it was sent for.
 *
 * The step *numbers* never move. Step 1 is "the first question" and step 2 is
 * "the second" on every path, so a wizard resumed from saved localStorage
 * state lands at the same place in the flow, and the stepper's jump rules do
 * not have to know any of this.
 */
export type OnboardingPath = "create" | "grow" | null;

export type OnboardingQuestionSteps = {
  /** True for a run that starts at the first question and creates a company. */
  buildsNewOrganization: boolean;
  /** The step that asks for the mission, or null when the path has none. */
  missionStep: 1 | 2 | null;
  /** The step that asks for the organization's name. */
  nameStep: 1 | 2;
};

export function onboardingQuestionSteps(
  path: OnboardingPath,
  entryStep: number,
): OnboardingQuestionSteps {
  // A wizard opened straight onto the questions — no front door, which is what
  // happens on an instance with no organizations — is building a new one.
  const buildsNewOrganization = path !== "grow" && entryStep <= 1;
  if (buildsNewOrganization) {
    return { buildsNewOrganization: true, missionStep: 1, nameStep: 2 };
  }
  return {
    buildsNewOrganization: false,
    // The grow path has no mission screen at all; every other run that did not
    // start at the front door keeps the mission on the step it was sent to.
    missionStep: path === "grow" ? null : 2,
    nameStep: 1,
  };
}
