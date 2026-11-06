import { LaunchProps } from "@raycast/api";
import { quickGenerate } from "./lib/quick-generate";

export default async function Command(props: LaunchProps<{ arguments: Arguments.GeneratePassphrase }>) {
  await quickGenerate("passphrase", props.arguments.words);
}
