/* eslint-disable @typescript-eslint/no-var-requires */
import {
	App,
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	requestUrl,
	TFile,
	Notice,
	SuggestModal,
	TFolder,
	Platform,
} from "obsidian";
export class ToAnki {
	BuildAnkiFormat(question: string, answer: string) {
		question = `<font color=#0096ff>**[Polish up this in English]**</font> ${question}`
		return `%%<br>STARTI [Basic(MD)] ${question} Back: ${answer} %%` + `%% ENDI %%\n`
	}
	openFileByPath(filePath: string): TFile {
		const file = app.vault.getAbstractFileByPath(filePath) as TFile;
		if (file === null) {
			new Notice(`There is no file at path ${filePath}. You need to create the file first.`);
			throw new Error(`There is no file at path ${filePath}. You need to create the file first.`);
		}

		return file;
	}
	appendToNote(file: TFile, content: string): void {
		const currentContent = app.vault.append(file, content);
		//const newContent = `${content}\n${currentContent}`;
		//app.vault.modify(file, newContent);
	}
}
