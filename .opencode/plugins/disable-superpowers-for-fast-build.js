const TARGET_AGENT = "fast-build";
const BOOTSTRAP_MARKER = "You have superpowers.";

export default async () => ({
  "experimental.chat.messages.transform": async (_input, output) => {
    const isTargetAgent = output.messages.some(
      ({ info }) => info.role === "user" && info.agent === TARGET_AGENT,
    );

    if (!isTargetAgent) return;

    for (const message of output.messages) {
      message.parts = message.parts.filter(
        (part) =>
          !(
            part.type === "text" &&
            typeof part.text === "string" &&
            part.text.includes(BOOTSTRAP_MARKER)
          ),
      );
    }
  },
});
