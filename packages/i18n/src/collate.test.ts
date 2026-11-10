import { describe, expect, it } from "vitest";
import { compareStrings, sortStrings } from "./index";

describe("collation", () => {
  it("az: c<ç, e<ə, g<ğ, h<x<ı<i, o<ö, s<ş, u<ü, z last", () => {
    expect(sortStrings("az", ["z", "ü", "u", "ş", "s", "i", "ı", "x", "h", "ğ", "g", "ə", "e", "ö", "o", "ç", "c"])).toEqual([
      "c", "ç", "e", "ə", "g", "ğ", "h", "x", "ı", "i", "o", "ö", "s", "ş", "u", "ü", "z",
    ]);
  });
  it("tr: ı sorts before i; ç ğ ö ş ü follow their base letters", () => {
    expect(sortStrings("tr", ["z", "ü", "u", "ş", "s", "i", "ı", "ğ", "g", "ö", "o", "ç", "c"])).toEqual([
      "c", "ç", "g", "ğ", "ı", "i", "o", "ö", "s", "ş", "u", "ü", "z",
    ]);
  });
  it("az/tr: dotted and dotless i are different letters inside words", () => {
    expect(sortStrings("tr", ["ilk", "ısı", "iki", "ışık"])).toEqual(["ısı", "ışık", "iki", "ilk"]);
    expect(sortStrings("az", ["ilk", "ısı", "iki", "ışık"])).toEqual(["ısı", "ışık", "iki", "ilk"]);
    expect(compareStrings("tr", "ı", "i")).toBeLessThan(0);
  });
  it("az: place-name style words", () => {
    expect(sortStrings("az", ["Şəki", "Sumqayıt", "Çinar", "Əli", "Bakı", "Gəncə", "Elm", "Ülvi", "Ulu"])).toEqual([
      "Bakı", "Çinar", "Elm", "Əli", "Gəncə", "Sumqayıt", "Şəki", "Ulu", "Ülvi",
    ]);
  });
  it("ru: Cyrillic alphabetical (ё is a variant of е: compares by the following letters first)", () => {
    expect(sortStrings("ru", ["Яблоко", "Ёлка", "Арбуз", "Ель", "Жук", "Вода"])).toEqual(["Арбуз", "Вода", "Ёлка", "Ель", "Жук", "Яблоко"]);
  });
  it("en: Latin and numeric aware; sortStrings does not mutate and supports a key", () => {
    const input = ["b", "a10", "a2", "A1"];
    expect(sortStrings("en", input)).toEqual(["A1", "a2", "a10", "b"]);
    expect(input).toEqual(["b", "a10", "a2", "A1"]);
    expect(sortStrings("en", [{ n: "b" }, { n: "a" }], (x) => x.n).map((x) => x.n)).toEqual(["a", "b"]);
  });
});
