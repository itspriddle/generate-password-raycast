import { LaunchProps } from "@raycast/api";
import { quickGenerate } from "./lib/quick-generate";

export default async function Command(props: LaunchProps<{ arguments: Arguments.GeneratePin }>) {
  await quickGenerate("pin", props.arguments.length);
}
