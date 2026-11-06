import { LaunchProps } from "@raycast/api";
import { quickGenerate } from "./lib/quick-generate";

export default async function Command(props: LaunchProps<{ arguments: Arguments.GeneratePassword }>) {
  await quickGenerate("password", props.arguments.length);
}
