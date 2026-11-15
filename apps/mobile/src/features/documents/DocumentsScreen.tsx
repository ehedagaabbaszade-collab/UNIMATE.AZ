import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import Animated, { Easing, interpolate, withDelay, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, Keyboard, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { IconName } from "@unimate/ui/icons";
import { EdgeNotice } from "../../components/EdgeNotice";
import { GlassSurface } from "../../components/Glass";
import { Icon } from "../../components/Icon";
import { AppText, HeroTitle, ListGroup, ListRow, Notice, Pill, PressableScale, Reveal, Screen, Skeleton, useToast } from "../../components/ui";
import type { DocumentRow } from "../../lib/db";
import { DOC_COLUMNS, POLL_MS, anyInFlight } from "../../lib/documents";
import { edgeErrorMessageKey, type EdgeError, type StructuredCitation } from "../../lib/edge";
import { askDocument, generateSummary } from "../../lib/edge-client";
import { EASE_OUT, useReducedMotion } from "../../lib/motion";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { radii, spacing } from "../../theme/tokens";
import { pickDocument, pickImage, uploadDocument, type PickedFile } from "./upload-flow";

const COMPOSER_H = 52;
/** Space between the composer and the top of the open keyboard. */
const KB_GAP = 10;
let voiceHintSeen = false; // one-time dictation hint per app session

interface Bubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: StructuredCitation[];
  grounded?: boolean;
}

/** AI Study is a chat first: pick a document as context, ask, or jump to summary / quiz / cards / independent work. */
export function DocumentsScreen() {
  const { t, date, locale } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { user, supabase: sb } = useUser();
  const { toast } = useToast();
  const docs = useAsync<DocumentRow[]>(async () => unwrap(await sb.from("documents").select(DOC_COLUMNS).order("created_at", { ascending: false })), []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [edgeError, setEdgeError] = useState<EdgeError | null>(null);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);

  // Live status: poll while anything is still being processed (Realtime is not enabled for these tables).
  const inFlight = anyInFlight(docs.data);
  const reload = docs.reload;
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(reload, POLL_MS);
    return () => clearInterval(id);
  }, [inFlight, reload]);

  const ready = (docs.data ?? []).filter((d) => d.status === "ready"); // newest first
  const doc = ready.find((d) => d.id === selectedId) ?? ready[0] ?? null;

  function selectDoc(id: string) {
    setPickerOpen(false);
    if (id === doc?.id) return;
    setSelectedId(id);
    setMessages([]); // a conversation belongs to one document
    setConversationId(undefined);
    setEdgeError(null);
  }

  async function start(pick: () => Promise<PickedFile | null>) {
    setUploadError(null);
    const file = await pick().catch(() => null);
    if (!file) return;
    setUploading(true);
    let out: Awaited<ReturnType<typeof uploadDocument>>;
    try {
      out = await uploadDocument(sb, user.id, file);
    } catch (e) {
      // A thrown error (file read, network) must never leave the spinner running with no message.
      out = { kind: "failed", message: e instanceof Error ? e.message : "" };
    } finally {
      setUploading(false);
    }
    if (out.kind === "rejected") setUploadError(t(`documents.upload_errors.${out.error}` as MessageKey));
    else if (out.kind === "failed") setUploadError(out.message || t("common.genericError"));
    else if (out.kind === "uploaded") {
      if (out.processError) toast(t("documents.processStartFailed", { reason: t(edgeErrorMessageKey(out.processError), { message: out.processError.message ?? "" }) }), "error");
      else toast(t("documents.uploaded"), "success");
      docs.reload();
    }
  }

  const push = (b: Omit<Bubble, "id">) => setMessages((m) => [...m, { ...b, id: `b-${m.length}-${Date.now()}` }]);

  async function send() {
    const q = question.trim();
    if (!q || !doc || busy) return;
    setEdgeError(null);
    setQuestion("");
    push({ role: "user", content: q });
    setBusy(true);
    const res = await askDocument(doc.id, q, conversationId);
    setBusy(false);
    if (!res.ok) return setEdgeError(res.error);
    setConversationId(res.data.conversationId);
    push({ role: "assistant", content: res.data.answer, citations: res.data.citations, grounded: res.data.grounded });
  }

  async function summarise() {
    if (!doc || busy) return toast(t("mobile.aiStudy.needDoc"), "info");
    setEdgeError(null);
    push({ role: "user", content: t("mobile.aiStudy.sugSummary") });
    setBusy(true);
    const res = await generateSummary(doc.id, "short", locale);
    setBusy(false);
    if (!res.ok) return setEdgeError(res.error);
    const { summary, key_points } = res.data.output;
    push({ role: "assistant", content: [summary, ...key_points.map((p) => `• ${p}`)].join("\n") });
  }

  const openDoc = () => (doc ? router.push({ pathname: "/documents/[id]", params: { id: doc.id } }) : toast(t("mobile.aiStudy.needDoc"), "info"));

  const pageLabels = (cs: StructuredCitation[]) =>
    cs
      .filter((c) => c.page_start != null)
      .map((c) => (c.page_end != null && c.page_end !== c.page_start ? t("chat.pageRange", { a: c.page_start!, b: c.page_end }) : t("chat.pageSingle", { n: c.page_start! })))
      .filter((l, i, a) => a.indexOf(l) === i)
      .join(", ");

  const suggestions: { icon: IconName; title: string; hint: string; onPress: () => void }[] = [
    { icon: "summary", title: t("mobile.aiStudy.sugSummary"), hint: t("mobile.aiStudy.sugSummaryHint"), onPress: () => void summarise() },
    { icon: "quiz", title: t("mobile.aiStudy.sugQuiz"), hint: t("mobile.aiStudy.sugQuizHint"), onPress: openDoc },
    { icon: "flashcard", title: t("mobile.aiStudy.sugCards"), hint: t("mobile.aiStudy.sugCardsHint"), onPress: openDoc },
    { icon: "study-plan", title: t("mobile.aiStudy.sugWriting"), hint: t("mobile.aiStudy.sugWritingHint"), onPress: () => router.push("/writing") },
  ];

  const canSend = !!doc && question.trim().length > 0 && !busy;
  const hasText = question.trim().length > 0;

  // The composer is the bottom bar (the tab bar is hidden on this tab). Resting: `rest` pt above the screen bottom.
  // Keyboard open: lifted so its bottom edge sits KB_GAP pt above the keyboard top on any phone (kb = reported height).
  const { bottom } = useSafeAreaInsets();
  const rest = Math.max(bottom - 4, 12);
  const reduce = useReducedMotion();
  const ms = reduce ? 0 : 240;
  const kb = useSharedValue(0); // keyboard height (0 = closed)
  const focus = useSharedValue(0);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const move = (h: number, d?: number) => {
      kb.value = withTiming(h, { duration: reduce ? 0 : (d ?? 250), easing: Easing.bezier(0.17, 0.59, 0.4, 0.77) });
    };
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => move(e.endCoordinates.height, e.duration));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) => move(0, e.duration));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [kb, reduce]);
  // Every time the tab is focused the system bar slides away (native animation) and the composer rises into its place,
  // so the bar swap reads as one motion instead of a hitch. UI thread only.
  const enter = useSharedValue(reduce ? 1 : 0);
  useFocusEffect(
    useCallback(() => {
      if (reduce) return;
      enter.value = 0;
      enter.value = withDelay(60, withTiming(1, { duration: 300, easing: EASE_OUT }));
    }, [enter, reduce]),
  );
  const composerStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: -Math.max(kb.value + KB_GAP - rest, 0) + (1 - enter.value) * (COMPOSER_H + bottom) }],
  }));
  // Padding is a layout prop: animating it per frame re-lays out the whole list (keyboard lag). Set it once per show/hide.
  const [kbOpen, setKbOpen] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const s = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => setKbOpen(e.endCoordinates.height));
    const h = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKbOpen(0));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);
  // Bottom space lives inside the scroll content, so the list runs edge to edge and shows through the glass composer.
  const listPad = COMPOSER_H + 16 + (kbOpen > 0 ? kbOpen + KB_GAP : rest);
  const sideStyle = useAnimatedStyle(() => ({ width: interpolate(focus.value, [0, 1], [COMPOSER_H + spacing.sm, 0]), opacity: interpolate(focus.value, [0, 1], [1, 0]) }));
  const closeStyle = useAnimatedStyle(() => ({ width: interpolate(focus.value, [0, 1], [0, COMPOSER_H + spacing.sm]), opacity: focus.value }));
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(id);
  }, [hint]);
  const dictate = () => {
    inputRef.current?.focus();
    if (!voiceHintSeen) {
      voiceHintSeen = true;
      setHint(true);
    }
  };
  const glassBtn = { width: COMPOSER_H, height: COMPOSER_H, alignItems: "center", justifyContent: "center" } as const;
  return (
    <Screen ambient scroll={false} padded={false}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
        <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" scrollIndicatorInsets={{ bottom: listPad }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: listPad }} onContentSizeChange={() => messages.length > 0 && scroller.current?.scrollToEnd({ animated: true })}>
          <Reveal>
            <HeroTitle muted={t("mobile.aiStudy.heroMuted")} strong={t("mobile.aiStudy.heroStrong")} />
          </Reveal>
          <AppText muted>{t("mobile.aiStudy.subtitle")}</AppText>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {docs.loading && !docs.data ? (
              <Skeleton height={36} width={160} radius={18} />
            ) : doc ? (
              <Pill label={doc.title} tone="accent" icon={<Icon name="materials" size={16} color="#FFFFFF" />} onPress={() => setPickerOpen(true)} />
            ) : null}
            <Pill label={t("mobile.aiStudy.myDocs")} onPress={() => router.push("/documents")} />
          </View>

          {messages.length === 0 && !busy ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
              {suggestions.map((s, i) => (
                <Reveal key={s.icon} index={i} style={{ width: "47.5%", flexGrow: 1 }}>
                  <PressableScale onPress={s.onPress} accessibilityRole="button" accessibilityLabel={`${s.title}. ${s.hint}`} style={{ minHeight: 132, padding: spacing.lg, borderRadius: radii.xl - 4, borderCurve: "continuous", backgroundColor: theme.card, justifyContent: "space-between" }}>
                    <Icon name={s.icon} size={26} color={theme.active} />
                    <View style={{ gap: 2 }}>
                      <AppText style={{ fontWeight: "600", fontSize: 17 }}>{s.title}</AppText>
                      <AppText variant="caption" muted>
                        {s.hint}
                      </AppText>
                    </View>
                  </PressableScale>
                </Reveal>
              ))}
            </View>
          ) : null}

          <View accessibilityLiveRegion="polite" style={{ gap: spacing.md }}>
            {messages.map((m) => {
              const mine = m.role === "user";
              const pages = m.citations && m.citations.length > 0 ? pageLabels(m.citations) : "";
              return (
                <Reveal key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "88%" }}>
                  <View style={{ backgroundColor: mine ? theme.ink : theme.card, borderRadius: radii.xl - 4, borderCurve: "continuous", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: 6 }}>
                    <Text selectable maxFontSizeMultiplier={1.6} style={{ color: mine ? "#FFFFFF" : theme.text, fontSize: 16, lineHeight: 23 }}>
                      {m.content}
                    </Text>
                    {m.citations && m.citations.length > 0 ? (
                      <AppText variant="caption" muted>
                        {pages ? `${t("chat.sources")}: ${pages}` : `${t("chat.sources")}: ${m.citations.length}`}
                      </AppText>
                    ) : null}
                    {m.grounded === false ? <Notice tone="warning" text={t("chat.notGrounded")} /> : null}
                  </View>
                </Reveal>
              );
            })}
            {busy ? (
              <View accessibilityLabel={t("chat.thinking")} style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: theme.card, borderRadius: radii.xl - 4, paddingVertical: spacing.md, paddingHorizontal: spacing.lg }}>
                <ActivityIndicator color={theme.textMuted} />
                <AppText muted>{t("chat.thinking")}</AppText>
              </View>
            ) : null}
          </View>

          {edgeError ? <EdgeNotice error={edgeError} /> : null}
          {uploadError ? <Notice text={uploadError} /> : null}
        </ScrollView>
        </View>

        {/* Composer (iOS 26 Safari style): [attach] [ask pill + mic/send] [more]; focus collapses the sides and shows a close button. */}
        {/* No entrance animation: it must already be there the frame the tab bar disappears, or the swap shows an empty gap. */}
        <Animated.View pointerEvents="box-none" style={[{ position: "absolute", left: 0, right: 0, bottom: rest, paddingHorizontal: spacing.lg }, composerStyle]}>
          {hint ? (
            <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: COMPOSER_H + spacing.sm + 6, backgroundColor: theme.card, borderRadius: radii.lg, padding: spacing.md }}>
              <AppText variant="caption" muted>
                {t("mobile.aiStudy.voiceHint")}
              </AppText>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Animated.View style={[{ overflow: "hidden", paddingRight: spacing.sm }, sideStyle]}>
              <GlassSurface radius={COMPOSER_H / 2} style={glassBtn}>
                <PressableScale accessibilityRole="button" accessibilityLabel={t("common.back")} style={glassBtn} onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))}>
                  <Icon name="chevron-left" color={theme.text} />
                </PressableScale>
              </GlassSurface>
            </Animated.View>
            <GlassSurface radius={COMPOSER_H / 2} style={{ flex: 1, height: COMPOSER_H, flexDirection: "row", alignItems: "center", paddingLeft: spacing.lg, paddingRight: 8, gap: 10 }}>
              <Icon name="sparkles" size={20} color={theme.textMuted} />
              <TextInput
                ref={inputRef}
                value={question}
                onChangeText={setQuestion}
                onFocus={() => {
                  focus.value = withTiming(1, { duration: ms, easing: EASE_OUT });
                }}
                onBlur={() => {
                  focus.value = withTiming(0, { duration: ms, easing: EASE_OUT });
                }}
                onSubmitEditing={() => void send()}
                editable={!!doc}
                maxLength={2000}
                returnKeyType="send"
                accessibilityLabel={doc ? t("mobile.aiStudy.askPlaceholder") : t("mobile.aiStudy.composerNoDoc")}
                placeholder={doc ? t("mobile.aiStudy.askPlaceholder") : t("mobile.aiStudy.composerNoDoc")}
                placeholderTextColor={theme.textMuted}
                maxFontSizeMultiplier={1.4}
                numberOfLines={1}
                style={{ flex: 1, height: COMPOSER_H, color: theme.text, fontSize: 16 }}
              />
              {hasText ? (
                <PressableScale disabled={!canSend} accessibilityRole="button" accessibilityLabel={t("mobile.aiStudy.send")} onPress={() => void send()} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", opacity: canSend ? 1 : 0.4 }}>
                  <Icon name="arrow-up" size={20} color={theme.onPrimary} />
                </PressableScale>
              ) : (
                <PressableScale disabled={!doc} accessibilityRole="button" accessibilityLabel={t("mobile.aiStudy.mic")} onPress={dictate} style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="mic" size={20} color={theme.textMuted} />
                </PressableScale>
              )}
            </GlassSurface>
            <Animated.View style={[{ overflow: "hidden", paddingLeft: spacing.sm }, sideStyle]}>
              <GlassSurface radius={COMPOSER_H / 2} style={glassBtn}>
                <PressableScale accessibilityRole="button" accessibilityLabel={t("mobile.aiStudy.more")} style={glassBtn} disabled={uploading} onPress={() => Alert.alert(t("mobile.aiStudy.more"), t("documents.uploadHint"), [{ text: t("documents.dropTitle"), onPress: () => void start(pickDocument) }, { text: t("mobile.documents.pickImage"), onPress: () => void start(pickImage) }, { text: t("mobile.aiStudy.pickerTitle"), onPress: () => setPickerOpen(true) }, { text: t("mobile.aiStudy.myDocs"), onPress: () => router.push("/documents") }, { text: t("common.cancel"), style: "cancel" }])}>
                  {uploading ? <ActivityIndicator color={theme.text} /> : <Icon name="more-horizontal" color={theme.text} />}
                </PressableScale>
              </GlassSurface>
            </Animated.View>
            <Animated.View style={[{ overflow: "hidden", paddingLeft: spacing.sm }, closeStyle]}>
              <GlassSurface radius={COMPOSER_H / 2} style={glassBtn}>
                <PressableScale accessibilityRole="button" accessibilityLabel={t("common.close")} style={glassBtn} onPress={() => inputRef.current?.blur()}>
                  <Icon name="close" color={theme.text} />
                </PressableScale>
              </GlassSurface>
            </Animated.View>
          </View>
        </Animated.View>
      </View>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable accessibilityLabel={t("common.close")} onPress={() => setPickerOpen(false)} style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: "flex-end" }}>
          <Pressable accessible={false} style={{ maxHeight: "70%", backgroundColor: theme.bg, borderTopLeftRadius: radii.xxl, borderTopRightRadius: radii.xxl, borderCurve: "continuous", padding: spacing.lg, paddingBottom: spacing.xl }}>
            <ScrollView>
              <ListGroup title={t("mobile.aiStudy.pickerTitle")}>
                {ready.map((d) => (
                  <ListRow key={d.id} icon="materials" title={d.title} subtitle={date(d.created_at)} trailing={d.id === doc?.id ? <Icon name="check" size={20} color={theme.active} /> : undefined} onPress={() => selectDoc(d.id)} />
                ))}
              </ListGroup>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
