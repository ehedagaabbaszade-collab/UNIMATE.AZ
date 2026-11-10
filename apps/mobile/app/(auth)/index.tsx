import { Redirect } from "expo-router";

/** "/" while signed out. The signed-in "/" is (app)/(tabs)/index; the root Stack.Protected guards keep only one of them active. */
export default function AuthIndex() {
  return <Redirect href="/sign-in" />;
}
