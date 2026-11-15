import { TabInsetContext } from "../../../src/components/Glass";
import { DocumentsScreen } from "../../../src/features/documents/DocumentsScreen";

/** The tab bar is hidden here (the composer replaces it), so no tab-bar clearance; the composer handles the bottom inset. */
export default function Study() {
  return (
    <TabInsetContext.Provider value={0}>
      <DocumentsScreen />
    </TabInsetContext.Provider>
  );
}
