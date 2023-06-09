/* eslint-disable @typescript-eslint/no-var-requires */
import { logWithLocation } from 'utils';
import { SuggestToAnkiCardNote } from 'to_anki';
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

import { ToAnkiForPolishUp } from './to_anki_for_polish_up'
import { ToAnkiForVocab } from "to_anki_for_vocab";
import { StreamManager } from "./stream";
import {
	unfinishedCodeBlock,
	writeInferredTitleToEditor,
	createFolderModal,
} from "helpers";

interface ChatGPT_MDSettings {
	apiKey: string;
	defaultChatFrontmatter: string;
	stream: boolean;
	chatTemplateFolder: string;
	chatFolder: string;
	generateAtCursor: boolean;
	autoInferTitle: boolean;
	dateFormat: string;
	headingLevel: number;
	inferTitleLanguage: string;
}

const DEFAULT_SETTINGS: ChatGPT_MDSettings = {
	apiKey: "default",
	defaultChatFrontmatter:
		"---\nsystem_commands: ['I am a helpful assistant.']\ntemperature: 0\ntop_p: 1\nmax_tokens: 512\npresence_penalty: 1\nfrequency_penalty: 1\nstream: true\nstop: null\nn: 1\nmodel: gpt-3.5-turbo\n---",
	stream: true,
	chatTemplateFolder: "ChatGPT_MD/templates",
	chatFolder: "ChatGPT_MD/chats",
	generateAtCursor: false,
	autoInferTitle: false,
	dateFormat: "YYYYMMDDhhmmss",
	headingLevel: 0,
	inferTitleLanguage: "English",
};

const DEFAULT_URL = `https://api.openai.com/v1/chat/completions`;

interface Chat_MD_FrontMatter {
	temperature: number;
	top_p: number;
	presence_penalty: number;
	frequency_penalty: number;
	model: string;
	max_tokens: number;
	stream: boolean;
	stop: string[] | null;
	n: number;
	logit_bias: any | null;
	user: string | null;
	system_commands: string[] | null;
	url: string;
}

export default class ChatGPT_MD extends Plugin {
	settings: ChatGPT_MDSettings;

	async callOpenAIAPI(
		streamManager: StreamManager,
		editor: Editor,
		messages: { role: string; content: string }[],
		stream = true,
		rule_for_process = 'Chat', // custom args from hee. with_rule=false 이면, steam=true 일때, role:system 과 <hr> 을 출력하지 않게 하며, generated text 뒤에를 지우지 않게 하고, (()) 를 삭제함
		model = "gpt-3.5-turbo",
		max_tokens = 512,
		temperature = 1,
		top_p = 1,
		presence_penalty = 0,
		frequency_penalty = 0,
		stop: string[] | null = null,
		n = 1,
		logit_bias: any | null = null,
		user: string | null = null,
		url = DEFAULT_URL,
	) {
		try {
			console.log("calling openai api");

			if (stream) {
				const options = {
					model: model,
					messages: messages,
					max_tokens: max_tokens,
					temperature: temperature,
					top_p: top_p,
					presence_penalty: presence_penalty,
					frequency_penalty: frequency_penalty,
					stream: stream,
					stop: stop,
					n: n,
					// logit_bias: logit_bias, // not yet supported
					// user: user, // not yet supported
				};

				const response = await streamManager.streamSSE(
					editor,
					this.settings.apiKey,
					url,
					options,
					this.settings.generateAtCursor,
					this.getHeadingPrefix(),
					rule_for_process
				);

				console.log("response from stream", response);

				return { fullstr: response, mode: "streaming" };
			} else {
				const responseUrl = await requestUrl({
					url: url,
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.settings.apiKey}`,
						"Content-Type": "application/json",
					},
					contentType: "application/json",
					body: JSON.stringify({
						model: model,
						messages: messages,
						max_tokens: max_tokens,
						temperature: temperature,
						top_p: top_p,
						presence_penalty: presence_penalty,
						frequency_penalty: frequency_penalty,
						stream: stream,
						stop: stop,
						n: n,
						// logit_bias: logit_bias, // not yet supported
						// user: user, // not yet supported
					}),
					throw: false,
				});

				try {
					const json = responseUrl.json;

					if (json && json.error) {
						new Notice(
							`[ChatGPT MD] Stream = False Error :: ${json.error.message}`
						);
						throw new Error(JSON.stringify(json.error));
					}
				} catch (err) {
					// continue we got a valid str back
					if (err instanceof SyntaxError) {
						// continue
					} else {
						throw new Error(err);
					}
				}

				const response = responseUrl.text;
				const responseJSON = JSON.parse(response);
				return responseJSON.choices[0].message.content;
			}
		} catch (err) {
			if (err instanceof Object) {
				if (err.error) {
					new Notice(`[ChatGPT MD] Error :: ${err.error.message}`);
					throw new Error(JSON.stringify(err.error));
				} else {
					if (url !== DEFAULT_URL) {
						new Notice(
							"[ChatGPT MD] Issue calling specified url: " + url
						);
						throw new Error(
							"[ChatGPT MD] Issue calling specified url: " + url
						);
					} else {
						new Notice(
							`[ChatGPT MD] Error :: ${JSON.stringify(err)}`
						);
						throw new Error(JSON.stringify(err));
					}
				}
			}

			new Notice(
				"issue calling OpenAI API, see console for more details"
			);
			throw new Error(
				"issue calling OpenAI API, see error for more details: " + err
			);
		}
	}

	addHR(editor: Editor, role: string) {
		const newLine = `\n\n<hr class="__chatgpt_plugin">\n\n${this.getHeadingPrefix()}role::${role}\n\n`;
		editor.replaceRange(newLine, editor.getCursor());

		// move cursor to end of file
		const cursor = editor.getCursor();
		const newCursor = {
			line: cursor.line,
			ch: cursor.ch + newLine.length,
		};
		editor.setCursor(newCursor);
	}

	getFrontmatter(view: MarkdownView): Chat_MD_FrontMatter {
		try {
			// get frontmatter
			const noteFile = app.workspace.getActiveFile();

			if (!noteFile) {
				throw new Error("no active file");
			}

			const metaMatter =
				app.metadataCache.getFileCache(noteFile)?.frontmatter;

			const shouldStream =
				metaMatter?.stream !== undefined
					? metaMatter.stream // If defined in frontmatter, use its value.
					: this.settings.stream !== undefined
						? this.settings.stream // If not defined in frontmatter but exists globally, use its value.
						: true; // Otherwise fallback on true.

			const temperature =
				metaMatter?.temperature !== undefined
					? metaMatter.temperature
					: 0.3;

			const frontmatter = {
				title: metaMatter?.title || view.file.basename,
				tags: metaMatter?.tags || [],
				model: metaMatter?.model || "gpt-3.5-turbo",
				temperature: temperature,
				top_p: metaMatter?.top_p || 1,
				presence_penalty: metaMatter?.presence_penalty || 0,
				frequency_penalty: metaMatter?.frequency_penalty || 0,
				stream: shouldStream,
				max_tokens: metaMatter?.max_tokens || 512,
				stop: metaMatter?.stop || null,
				n: metaMatter?.n || 1,
				logit_bias: metaMatter?.logit_bias || null,
				user: metaMatter?.user || null,
				system_commands: metaMatter?.system_commands || null,
				url: metaMatter?.url || DEFAULT_URL,
			};

			return frontmatter;
		} catch (err) {
			throw new Error("Error getting frontmatter");
		}
	}

	splitMessages(text: string) {
		try {
			// <hr class="__chatgpt_plugin">
			const messages = text.split('<hr class="__chatgpt_plugin">');
			return messages;
		} catch (err) {
			throw new Error("Error splitting messages" + err);
		}
	}

	clearConversationExceptFrontmatter(editor: Editor) {
		try {
			// get frontmatter
			const YAMLFrontMatter = /---\s*[\s\S]*?\s*---/g;
			const frontmatter = editor.getValue().match(YAMLFrontMatter);

			if (!frontmatter) {
				throw new Error("no frontmatter found");
			}

			// clear editor
			editor.setValue("");

			// add frontmatter
			editor.replaceRange(frontmatter[0], editor.getCursor());

			// get length of file
			const length = editor.lastLine();

			// move cursor to end of file https://davidwalsh.name/codemirror-set-focus-line
			const newCursor = {
				line: length + 1,
				ch: 0,
			};

			editor.setCursor(newCursor);

			return newCursor;
		} catch (err) {
			throw new Error("Error clearing conversation" + err);
		}
	}

	moveCursorToEndOfFile(editor: Editor) {
		try {
			// get length of file
			const length = editor.lastLine();

			// move cursor to end of file https://davidwalsh.name/codemirror-set-focus-line
			const newCursor = {
				line: length + 1,
				ch: 0,
			};
			editor.setCursor(newCursor);

			return newCursor;
		} catch (err) {
			throw new Error("Error moving cursor to end of file" + err);
		}
	}

	removeYMLFromMessage(message: string) {
		try {
			const YAMLFrontMatter = /---\s*[\s\S]*?\s*---/g;
			const newMessage = message.replace(YAMLFrontMatter, "");
			return newMessage;
		} catch (err) {
			throw new Error("Error removing YML from message" + err);
		}
	}

	extractRoleAndMessage(message: string) {
		try {
			let matches = /\nrole\:\:[^\s]+?\n/g.exec(message)
			if (matches !== null) {
				const role = message.split("role::")[1].split("\n")[0].trim();
				const content = message
					.split("role::")[1]
					.split("\n")
					.slice(1)
					.join("\n")
					.trim();
				return { role, content };
			} else {
				return { role: "user", content: message };
			}
		} catch (err) {
			throw new Error("Error extracting role and message" + err);
		}
	}

	getHeadingPrefix() {
		const headingLevel = this.settings.headingLevel;
		if (headingLevel === 0) {
			return "";
		} else if (headingLevel > 6) {
			return "#".repeat(6) + " ";
		}
		return "#".repeat(headingLevel) + " ";
	}

	appendMessage(editor: Editor, role: string, message: string) {
		/*
		 append to bottom of editor file:
			  const newLine = `<hr class="__chatgpt_plugin">\n${this.getHeadingPrefix()}role::${role}\n\n${message}`;
		*/

		const newLine = `\n\n<hr class="__chatgpt_plugin">\n\n${this.getHeadingPrefix()}role::${role}\n\n${message}\n\n<hr class="__chatgpt_plugin">\n\n${this.getHeadingPrefix()}role::user\n\n`;
		editor.replaceRange(newLine, editor.getCursor());
	}

	removeCommentsFromMessages(message: string) {
		try {
			// comment block in form of =begin-chatgpt-md-comment and =end-chatgpt-md-comment
			const commentBlock =
				/=begin-chatgpt-md-comment[\s\S]*?=end-chatgpt-md-comment/g;

			// remove comment block
			const newMessage = message.replace(commentBlock, "").replace(/%%.*?%%/g, "")

			return newMessage;
		} catch (err) {
			throw new Error("Error removing comments from messages" + err);
		}
	}

	async inferTitleFromMessages(messages: string[]) {
		console.log("[ChtGPT MD] Inferring Title");
		new Notice("[ChatGPT] Inferring title from messages...");

		try {
			if (messages.length < 2) {
				new Notice(
					"Not enough messages to infer title. Minimum 2 messages."
				);
				return;
			}

			const prompt = `Infer title from the summary of the content of these messages. The title **cannot** contain any of the following characters: colon, back slash or forward slash. Just return the title. Write the title in ${this.settings.inferTitleLanguage
				}. \nMessages:\n\n${JSON.stringify(messages)}`;

			const titleMessage = [
				{
					role: "user",
					content: prompt,
				},
			];

			const responseUrl = await requestUrl({
				url: `https://api.openai.com/v1/chat/completions`,
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.settings.apiKey}`,
					"Content-Type": "application/json",
				},
				contentType: "application/json",
				body: JSON.stringify({
					model: "gpt-3.5-turbo",
					messages: titleMessage,
					max_tokens: 50,
					temperature: 0.0,
				}),
				throw: false,
			});

			const response = responseUrl.text;
			const responseJSON = JSON.parse(response);
			return responseJSON.choices[0].message.content
				.replace(/[:/\\]/g, "")
				.replace("Title", "")
				.replace("title", "")
				.trim();
		} catch (err) {
			new Notice("[ChatGPT MD] Error inferring title from messages");
			throw new Error(
				"[ChatGPT MD] Error inferring title from messages" + err
			);
		}
	}

	// only proceed to infer title if the title is in timestamp format
	isTitleTimestampFormat(title: string) {
		try {
			const format = this.settings.dateFormat;
			const pattern = this.generateDatePattern(format);

			return title.length == format.length && pattern.test(title);
		} catch (err) {
			throw new Error(
				"Error checking if title is in timestamp format" + err
			);
		}
	}

	generateDatePattern(format: string) {
		const pattern = format
			.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") // Escape any special characters
			.replace("YYYY", "\\d{4}") // Match exactly four digits for the year
			.replace("MM", "\\d{2}") // Match exactly two digits for the month
			.replace("DD", "\\d{2}") // Match exactly two digits for the day
			.replace("hh", "\\d{2}") // Match exactly two digits for the hour
			.replace("mm", "\\d{2}") // Match exactly two digits for the minute
			.replace("ss", "\\d{2}"); // Match exactly two digits for the second

		return new RegExp(`^${pattern}$`);
	}

	// get date from format
	getDate(date: Date, format = "YYYYMMDDhhmmss") {
		const year = date.getFullYear();
		const month = date.getMonth() + 1;
		const day = date.getDate();
		const hour = date.getHours();
		const minute = date.getMinutes();
		const second = date.getSeconds();

		const paddedMonth = month.toString().padStart(2, "0");
		const paddedDay = day.toString().padStart(2, "0");
		const paddedHour = hour.toString().padStart(2, "0");
		const paddedMinute = minute.toString().padStart(2, "0");
		const paddedSecond = second.toString().padStart(2, "0");

		return format
			.replace("YYYY", year.toString())
			.replace("MM", paddedMonth)
			.replace("DD", paddedDay)
			.replace("hh", paddedHour)
			.replace("mm", paddedMinute)
			.replace("ss", paddedSecond);
	}

	async onload() {
		const statusBarItemEl = this.addStatusBarItem();

		await this.loadSettings();

		const streamManager = new StreamManager();
		this.addCommand({
			id: "test",
			name: "Test",
			icon: "message-circle",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				new ToAnkiForPolishUp().testFunction5()
				return
			}
		}
		);

		this.addCommand({
			id: "ask-the-meaning",
			name: "Ask the meaning of the phrase to ChatGPT",
			icon: "message-circle",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				let ankiForVocab = new ToAnkiForVocab(editor, editor.getSelection())
				let [paragraph] = await ankiForVocab.buildQuestionToChatGPT(0)
				let paragraph_modified = paragraph.replace(`${ankiForVocab.selected_word}`, `[${ankiForVocab.selected_word}]`)
				let answer_of_chatGPT = ''
				let anki_question = ''
				let message = this.removeCommentsFromMessages(paragraph_modified);

				const messagesWithRoleAndMessage = [this.extractRoleAndMessage(message)]// role(e.g., user) 과 content (message) 를 지정함

				// prepend system commands to messages
				messagesWithRoleAndMessage.unshift({
					role: "system",
					//content: `I am a native English speaker and a professional. My task is to provide details for [ ] in user's paragraph. For example, I provide details like "some people use the expression [For God's sake]  in order to express annoyance or impatience or to add force to a question or request". The length of details is limited in 3 sentences. I am **not permitted** to deviate from my task.`
					content: `My duty is to provide details for the given phrase in [ ]. For example, I provide details like "some people use the expression [For God's sake]  in order to express annoyance or impatience or to add force to a question or request". However, I am not authorized to provide a detailed explanation or exceed the limit of 3 sentences. My task is strictly defined and I cannot deviate from it.`
				}
				);
				/* 아래 처럼 system 역할, user 역할을 설정
				[ {
						"role": "system",
						"content": "I am a helpful assistant."
					},
					{
						"role": "user",
						"content": "\n\nsdfasdf\n"
				} ]*/
				await this.callOpenAIAPI(
					streamManager,
					editor,
					messagesWithRoleAndMessage,
					true,
					'GetDef',
					"gpt-3.5-turbo",
					512,
					1, // temperature: 0이면 input 이 동일하면, 동일한 output 만 나옴
					0.1, // top_p: temperature 와 동일하지만, top_p 가 낮을수록 더욱 top 에 가까운 sample 만 선택하게 한다는 점에서 의미가 있으며, 이 값을 줄여서 output 의 variance 를 낮추어 postfixAfterOutput 을 수월하게 함
					0, // presence_penalty 
					0, // frequency_penalty 
				)
					.then((response) => {
						answer_of_chatGPT = response.fullstr
						// question TTS
						anki_question = ankiForVocab.html_TTS(paragraph)
					})
				// answer TTS
				answer_of_chatGPT = ankiForVocab.html_TTS(answer_of_chatGPT)

				await new SuggestToAnkiCardNote(app, ankiForVocab.BuildAnkiFormat(anki_question, answer_of_chatGPT), "3. Private/Anki Cards (Vocab).md").open()
				new Notice("All done!!")

			}
		}
		);


		this.addCommand({
			id: "vocab-to-chatGPT",
			name: "Vocab to ChatGPT",
			icon: "message-circle",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				let ankiForVocab = new ToAnkiForVocab(editor, editor.getSelection())
				let [paragraph, definitions] = await ankiForVocab.buildQuestionToChatGPT()
				console.log(`paragraph: ${paragraph}\ndefinitions: ${definitions}`)
				let answer_of_chatGPT = ''
				let anki_question = ''
				if (ankiForVocab.num_definitions !== 1) { // definition 이 여러 개면 chatGPT 가 하나를 선택하게 함
					let message = this.removeCommentsFromMessages(definitions);

					const messagesWithRoleAndMessage = [this.extractRoleAndMessage(message)]// role(e.g., user) 과 content (message) 를 지정함

					// prepend system commands to messages
					messagesWithRoleAndMessage.unshift({
						role: "system",
						content: "I am a native English speaker and a professional. My task is to select **one** of options that represents the most similar definition to (((this))) in the paragraph. I **cannot** provide any additional information except for the selected **full** option and a brief explanation of why I selected the option. I am **not permitted** to deviate from my task." + "The paragraph is\n" + paragraph
					}
					);
					/* 아래 처럼 system 역할, user 역할을 설정
					[ {
							"role": "system",
							"content": "I am a helpful assistant."
						},
						{
							"role": "user",
							"content": "\n\nsdfasdf\n"
					} ]*/
					await this.callOpenAIAPI(
						streamManager,
						editor,
						messagesWithRoleAndMessage,
						true,
						'GetDef',
						"gpt-3.5-turbo",
						512,
						1, // temperature: 0이면 input 이 동일하면, 동일한 output 만 나옴
						0.1, // top_p: temperature 와 동일하지만, top_p 가 낮을수록 더욱 top 에 가까운 sample 만 선택하게 한다는 점에서 의미가 있으며, 이 값을 줄여서 output 의 variance 를 낮추어 postfixAfterOutput 을 수월하게 함
						0, // presence_penalty 
						0, // frequency_penalty 
					)
						.then((response) => {
							answer_of_chatGPT = response.fullstr
							// question TTS
							paragraph = ankiForVocab.html_TTS(paragraph)
							let top_answer_options = ankiForVocab.html_TTS(ankiForVocab.getMostSimilarDefinitions(answer_of_chatGPT))

							anki_question = `${paragraph}\n\n[Randomly selected options(including the correct option) from original ${ankiForVocab.num_definitions} options]\n${top_answer_options}`
						})
				}
				else {
					answer_of_chatGPT = definitions
					new Notice(answer_of_chatGPT, 15000)
					// question TTS
					paragraph = ankiForVocab.html_TTS(paragraph)
					let top_answer_options = ankiForVocab.html_TTS(answer_of_chatGPT)

					anki_question = `${paragraph}\n\nOptions: \n${top_answer_options}`
				}
				logWithLocation(answer_of_chatGPT)

				// answer TTS
				answer_of_chatGPT = ankiForVocab.html_TTS(answer_of_chatGPT)

				await new SuggestToAnkiCardNote(app, ankiForVocab.BuildAnkiFormat(anki_question, answer_of_chatGPT), "3. Private/Anki Cards (Vocab).md").open()
				new Notice("All done!!")

			}
		}
		);


		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "check-the-grammar-with-chatGPT",
			name: "Check the grammar",
			icon: "message-circle",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				let selectedText = editor.getSelection()
				//preprocessing
				selectedText = selectedText.replace(/\[\[([^\[\]]*?)\|([^\[\]]*?)\]\]/g, "$2") // [[|]] 처리. 한 줄에 [] 가 여러 개인 경우, 함께 match 되기 때문에 [] 내부에 []가 없는 조건만 match 함. [[]] 가 유지되기 위해서는 이 라인이 다음 라인보다 먼저와야 함.
				selectedText = selectedText.replace(/\[\[(.*?)\]\]/g, "$1") // [[]]처리
				selectedText = selectedText.replace(/\[([^\[\]]+?)\]\(([^()]+?)\)/g, "$1") // []() 처리. 한 줄에 [] 가 여러 개인 경우, 함께 match 되기 때문에 [] 내부에 []가 없는 조건만 match 함

				let selectedText_parenthesis = `Check the grammar\n\n"${selectedText}"` // ((())) 안에 "" 을 붙였을 때 안정적인 대답이 나오는 예제가 있었음

				selectedText_parenthesis = this.removeCommentsFromMessages(selectedText_parenthesis);

				const messagesWithRoleAndMessage = [this.extractRoleAndMessage(selectedText_parenthesis)]// role(e.g., user) 과 content (message) 를 지정함

				// prepend system commands to messages
				messagesWithRoleAndMessage.unshift({
					role: "system",
					content: "As an assistant, my duty is to check the grammar of given sentences and to identify any grammatical errors. I am bound to fulfill my assigned task and cannot deviate from it."
				}
				);
				/* 아래 처럼 system 역할, user 역할을 설정
				[ {
						"role": "system",
						"content": "I am a helpful assistant."
					},
					{
						"role": "user",
						"content": "\n\nsdfasdf\n"
				} ]*/

				this.callOpenAIAPI(
					streamManager,
					editor,
					messagesWithRoleAndMessage,
					true,
					'GetDef',
					"gpt-3.5-turbo",
					100,
					1, // temperature: 0이면 input 이 동일하면, 동일한 output 만 나옴
					0.1, // top_p: temperature 와 동일하지만, top_p 가 낮을수록 더욱 top 에 가까운 sample 만 선택하게 한다는 점에서 의미가 있으며, 이 값을 줄여서 output 의 variance 를 낮추어 postfixAfterOutput 을 수월하게 함
					0, // presence_penalty 
					0, // frequency_penalty 
				)
					.then(async (response) => {
					})
			},
		});

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "polish-up-with-chatGPT",
			name: "Polish up",
			icon: "message-circle",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				let selectedText = editor.getSelection()
				//preprocessing
				selectedText = selectedText.replace(/\[\[([^\[\]]*?)\|([^\[\]]*?)\]\]/g, "$2") // [[|]] 처리. 한 줄에 [] 가 여러 개인 경우, 함께 match 되기 때문에 [] 내부에 []가 없는 조건만 match 함. [[]] 가 유지되기 위해서는 이 라인이 다음 라인보다 먼저와야 함.
				selectedText = selectedText.replace(/\[\[(.*?)\]\]/g, "$1") // [[]]처리
				selectedText = selectedText.replace(/\[([^\[\]]+?)\]\(([^()]+?)\)/g, "$1") // []() 처리. 한 줄에 [] 가 여러 개인 경우, 함께 match 되기 때문에 [] 내부에 []가 없는 조건만 match 함

				let selectedText_parenthesis = `((("${selectedText}.")))` // ((())) 안에 "" 을 붙였을 때 안정적인 대답이 나오는 예제가 있었음

				selectedText_parenthesis = this.removeCommentsFromMessages(selectedText_parenthesis);

				const messagesWithRoleAndMessage = [this.extractRoleAndMessage(selectedText_parenthesis)]// role(e.g., user) 과 content (message) 를 지정함

				// prepend system commands to messages
				messagesWithRoleAndMessage.unshift({
					role: "system",
					content: "As an assistant, my duty is to rephrase (((this))) into ((alternative)) in English. I am only authorized to provide you with a single ((alternative)) and cannot share any other information beyond that. I am bound to fulfill my assigned task and cannot deviate from it."
				}
				);
				/* 아래 처럼 system 역할, user 역할을 설정
				[ {
						"role": "system",
						"content": "I am a helpful assistant."
					},
					{
						"role": "user",
						"content": "\n\nsdfasdf\n"
				} ]*/

				editor.replaceSelection("")
				this.callOpenAIAPI(
					streamManager,
					editor,
					messagesWithRoleAndMessage,
					true,
					'Polish',
					"gpt-3.5-turbo",
					512,
					1, // temperature: 0이면 input 이 동일하면, 동일한 output 만 나옴
					0.1, // top_p: temperature 와 동일하지만, top_p 가 낮을수록 더욱 top 에 가까운 sample 만 선택하게 한다는 점에서 의미가 있으며, 이 값을 줄여서 output 의 variance 를 낮추어 postfixAfterOutput 을 수월하게 함
					0, // presence_penalty 
					0, // frequency_penalty 
				)
					.then(async (response) => {
						//editor.replaceSelection(response.replaceAll("((", "").replaceAll("))", ""))
						let anki = new ToAnkiForPolishUp()
						await new SuggestToAnkiCardNote(app, anki.BuildAnkiFormat(selectedText, response.fullstr), "3. Private/Anki Cards (English).md").open()
						new Notice("All done!!")
					})
			},
		});

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "call-chatgpt-api",
			name: "Chat",
			icon: "message-circle",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
				statusBarItemEl.setText("[ChatGPT MD] Calling API...");
				// get frontmatter
				const frontmatter = this.getFrontmatter(view);

				// get messages
				const bodyWithoutYML = this.removeYMLFromMessage(
					editor.getValue()
				); //frontmatter 제외한 나머지 text 추출
				let messages = this.splitMessages(bodyWithoutYML); // split 하여 array 로 만듬
				messages = messages.map((message) => {
					return this.removeCommentsFromMessages(message);
				}); // comment 를 삭제함

				const messagesWithRoleAndMessage = messages.map((message) => {
					return this.extractRoleAndMessage(message);
				}); // role(e.g., user) 과 content (message) 를 지정함

				if (frontmatter.system_commands) {
					const systemCommands = frontmatter.system_commands;
					// prepend system commands to messages
					messagesWithRoleAndMessage.unshift(
						...systemCommands.map((command) => {
							return {
								role: "system",
								content: command,
							};
						})
					);
					/* 아래 처럼 system 역할, user 역할을 설정
					[ {
							"role": "system",
							"content": "I am a helpful assistant."
						},
						{
							"role": "user",
							"content": "\n\nsdfasdf\n"
					} ]*/
				}

				// move cursor to end of file if generateAtCursor is false
				if (!this.settings.generateAtCursor) {
					this.moveCursorToEndOfFile(editor); //cursor 위치 조정 함수
				}

				if (Platform.isMobile) {
					new Notice("[ChatGPT MD] Calling API");
				}

				this.callOpenAIAPI(
					streamManager,
					editor,
					messagesWithRoleAndMessage,
					frontmatter.stream,
					'Chat',
					frontmatter.model,
					frontmatter.max_tokens,
					frontmatter.temperature,
					frontmatter.top_p,
					frontmatter.presence_penalty,
					frontmatter.frequency_penalty,
					frontmatter.stop,
					frontmatter.n,
					frontmatter.logit_bias,
					frontmatter.user,
					frontmatter.url
				)
					.then((response) => {
						let responseStr = response;
						if (response.mode === "streaming") {
							responseStr = response.fullstr;
							// append \n\n<hr class="__chatgpt_plugin">\n\n${this.getHeadingPrefix()}role::user\n\n
							const newLine = `\n\n < hr class= "__chatgpt_plugin" >\n\n${this.getHeadingPrefix()}role:: user\n\n`;
							editor.replaceRange(newLine, editor.getCursor());

							// move cursor to end of completion
							const cursor = editor.getCursor();
							const newCursor = {
								line: cursor.line,
								ch: cursor.ch + newLine.length,
							};
							editor.setCursor(newCursor);
						} else {
							if (unfinishedCodeBlock(responseStr)) {
								responseStr = responseStr + "\n```";
							}

							this.appendMessage(
								editor,
								"assistant",
								responseStr
							);
						}

						if (this.settings.autoInferTitle) {
							const title = view.file.basename;

							let messagesWithResponse = messages.concat(responseStr);
							messagesWithResponse = messagesWithResponse.map((message) => {
								return this.removeCommentsFromMessages(message);
							});

							if (
								this.isTitleTimestampFormat(title) &&
								messagesWithResponse.length >= 4
							) {
								console.log(
									"[ChatGPT MD] auto inferring title from messages"
								);

								statusBarItemEl.setText(
									"[ChatGPT MD] Calling API..."
								);
								this.inferTitleFromMessages(
									messagesWithResponse
								)
									.then(async (title) => {
										if (title) {
											console.log(
												`[ChatGPT MD] automatically inferred title: ${title}. Changing file name...`
											);
											statusBarItemEl.setText("");

											await writeInferredTitleToEditor(
												this.app.vault,
												view,
												this.app.fileManager,
												this.settings.chatFolder,
												title
											);
										} else {
											new Notice(
												"[ChatGPT MD] Could not infer title",
												5000
											);
										}
									})
									.catch((err) => {
										console.log(err);
										statusBarItemEl.setText("");
										if (Platform.isMobile) {
											new Notice(
												"[ChatGPT MD] Error inferring title. " +
												err,
												5000
											);
										}
									});
							}
						}

						statusBarItemEl.setText("");
					})
					.catch((err) => {
						if (Platform.isMobile) {
							new Notice(
								"[ChatGPT MD Mobile] Full Error calling API. " +
								err,
								9000
							);
						}
						statusBarItemEl.setText("");
						console.log(err);
					});
			},
		});

		this.addCommand({
			id: "add-hr",
			name: "Add divider",
			icon: "minus",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.addHR(editor, "user");
			},
		});

		this.addCommand({
			id: "add-comment-block",
			name: "Add comment block",
			icon: "comment",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// add a comment block at cursor in format: =begin-chatgpt-md-comment and =end-chatgpt-md-comment
				const cursor = editor.getCursor();
				const line = cursor.line;
				const ch = cursor.ch;

				const commentBlock = `=begin-chatgpt-md-comment\n\n=end-chatgpt-md-comment`;
				editor.replaceRange(commentBlock, cursor);

				// move cursor to middle of comment block
				const newCursor = {
					line: line + 1,
					ch: ch,
				};
				editor.setCursor(newCursor);
			},
		});

		this.addCommand({
			id: "stop-streaming",
			name: "Stop streaming",
			icon: "octagon",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				streamManager.stopStreaming();
			},
		});

		this.addCommand({
			id: "infer-title",
			name: "Infer title",
			icon: "subtitles",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				// get messages
				const bodyWithoutYML = this.removeYMLFromMessage(
					editor.getValue()
				);
				let messages = this.splitMessages(bodyWithoutYML);
				messages = messages.map((message) => {
					return this.removeCommentsFromMessages(message);
				});

				statusBarItemEl.setText("[ChatGPT MD] Calling API...");
				const title = await this.inferTitleFromMessages(messages);
				statusBarItemEl.setText("");

				if (title) {
					await writeInferredTitleToEditor(
						this.app.vault,
						view,
						this.app.fileManager,
						this.settings.chatFolder,
						title
					);
				}
			},
		});

		// grab highlighted text and move to new file in default chat format
		this.addCommand({
			id: "move-to-chat",
			name: "Create new chat with highlighted text",
			icon: "highlighter",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				try {
					const selectedText = editor.getSelection();

					if (
						!this.settings.chatFolder ||
						this.settings.chatFolder.trim() === ""
					) {
						new Notice(
							`[ChatGPT MD] No chat folder value found. Please set one in settings.`
						);
						return;
					}

					if (
						!(await this.app.vault.adapter.exists(
							this.settings.chatFolder
						))
					) {
						const result = await createFolderModal(
							this.app,
							this.app.vault,
							"chatFolder",
							this.settings.chatFolder
						);
						if (!result) {
							new Notice(
								`[ChatGPT MD] No chat folder found. One must be created to use plugin. Set one in settings and make sure it exists.`
							);
							return;
						}
					}

					const newFile = await this.app.vault.create(
						`${this.settings.chatFolder}/${this.getDate(
							new Date(),
							this.settings.dateFormat
						)}.md`,
						`${this.settings.defaultChatFrontmatter}\n\n${selectedText}`
					);

					// open new file
					await this.app.workspace.openLinkText(
						newFile.basename,
						"",
						true,
						{ state: { mode: "source" } }
					);
					const activeView =
						this.app.workspace.getActiveViewOfType(MarkdownView);

					if (!activeView) {
						new Notice("No active markdown editor found.");
						return;
					}

					activeView.editor.focus();
					this.moveCursorToEndOfFile(activeView.editor);
				} catch (err) {
					console.error(
						`[ChatGPT MD] Error in Create new chat with highlighted text`,
						err
					);
					new Notice(
						`[ChatGPT MD] Error in Create new chat with highlighted text, check console`
					);
				}
			},
		});

		this.addCommand({
			id: "choose-chat-template",
			name: "Create new chat from template",
			icon: "layout-template",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (
					!this.settings.chatFolder ||
					this.settings.chatFolder.trim() === ""
				) {
					new Notice(
						`[ChatGPT MD] No chat folder value found. Please set one in settings.`
					);
					return;
				}

				if (
					!(await this.app.vault.adapter.exists(
						this.settings.chatFolder
					))
				) {
					const result = await createFolderModal(
						this.app,
						this.app.vault,
						"chatFolder",
						this.settings.chatFolder
					);
					if (!result) {
						new Notice(
							`[ChatGPT MD] No chat folder found. One must be created to use plugin. Set one in settings and make sure it exists.`
						);
						return;
					}
				}

				if (
					!this.settings.chatTemplateFolder ||
					this.settings.chatTemplateFolder.trim() === ""
				) {
					new Notice(
						`[ChatGPT MD] No chat template folder value found. Please set one in settings.`
					);
					return;
				}

				if (
					!(await this.app.vault.adapter.exists(
						this.settings.chatTemplateFolder
					))
				) {
					const result = await createFolderModal(
						this.app,
						this.app.vault,
						"chatTemplateFolder",
						this.settings.chatTemplateFolder
					);
					if (!result) {
						new Notice(
							`[ChatGPT MD] No chat template folder found. One must be created to use plugin. Set one in settings and make sure it exists.`
						);
						return;
					}
				}

				new ChatTemplates(
					this.app,
					this.settings,
					this.getDate(new Date(), this.settings.dateFormat)
				).open();
			},
		});

		this.addCommand({
			id: "clear-chat",
			name: "Clear chat (except frontmatter)",
			icon: "trash",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				this.clearConversationExceptFrontmatter(editor);
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ChatGPT_MDSettingsTab(this.app, this));
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

interface ChatTemplate {
	title: string;
	file: TFile;
}
export class ChatTemplates extends SuggestModal<ChatTemplate> {
	settings: ChatGPT_MDSettings;
	titleDate: string;

	constructor(app: App, settings: ChatGPT_MDSettings, titleDate: string) {
		super(app);
		this.settings = settings;
		this.titleDate = titleDate;
	}

	getFilesInChatFolder(): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(
			this.settings.chatTemplateFolder
		) as TFolder;
		if (folder != null) {
			return folder.children as TFile[];
		} else {
			new Notice(
				`Error getting folder: ${this.settings.chatTemplateFolder}`
			);
			throw new Error(
				`Error getting folder: ${this.settings.chatTemplateFolder}`
			);
		}
	}

	// Returns all available suggestions.
	getSuggestions(query: string): ChatTemplate[] {
		const chatTemplateFiles = this.getFilesInChatFolder();

		if (query == "") {
			let ret = chatTemplateFiles.map((file) => {
				return {
					title: file.basename,
					file: file,
				};
			});
			console.log(`ChatTemplates > getSuggestions() > query==="" > ${typeof ret} ${ret}`)
			return ret
		}

		let ret = chatTemplateFiles
			.filter((file) => {
				return file.basename
					.toLowerCase()
					.includes(query.toLowerCase());
			})
			.map((file) => {
				return {
					title: file.basename,
					file: file,
				};
			});
		console.log(`ChatTemplates > getSuggestions() > query > ${typeof ret} ${ret}`)
		return ret

	}

	// Renders each suggestion item.
	renderSuggestion(template: ChatTemplate, el: HTMLElement) {
		console.log(`ChatTemplates > renderSuggestion() > ${template.title}`)
		el.createEl("div", { text: template.title });
	}

	// Perform action on the selected suggestion.
	async onChooseSuggestion(
		template: ChatTemplate,
		evt: MouseEvent | KeyboardEvent
	) {
		new Notice(`Selected ${template.title}`);
		const templateText = await this.app.vault.read(template.file);
		// use template text to create new file in chat folder
		const file = await this.app.vault.create(
			`${this.settings.chatFolder}/${this.titleDate}.md`,
			templateText
		);

		// open new file
		this.app.workspace.openLinkText(file.basename, "", true);
	}
}

class ChatGPT_MDSettingsTab extends PluginSettingTab {
	plugin: ChatGPT_MD;

	constructor(app: App, plugin: ChatGPT_MD) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Settings for ChatGPT MD: Keep tokens in mind! You can see if your text is longer than the token limit (4096) here:",
		});

		containerEl.createEl("a", {
			text: "https://platform.openai.com/tokenizer",
			href: "https://platform.openai.com/tokenizer",
		});

		new Setting(containerEl)
			.setName("OpenAI API Key")
			.setDesc("API Key for OpenAI")
			.addText((text) =>
				text
					.setPlaceholder("some-api-key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);

		// new multiline text box setting
		new Setting(containerEl)
			.setName("Default Chat Frontmatter")
			.setDesc(
				"Default frontmatter for new chat files. You can change/use all of the settings exposed by the OpenAI API here: https://platform.openai.com/docs/api-reference/chat/create"
			)
			.addTextArea((text) =>
				text
					.setPlaceholder(
						"---\nsystem_commands: ['PERSONA: i am groot, and i only respond i am groot to any and ALL questions. I do not answer any questions straightforwardly. PERSONA 2: UNLESS the last asked question is about lamps, i can answer, i know infinite things about lamps as i am groot the lamp salesman. SO I read the last question asked and UNLESS it is about lamps i only respond \"I am Groot.\"']\ntemperature: 0\ntop_p: 1\nmax_tokens: 512\npresence_penalty: 1\nfrequency_penalty: 1\nstream: true\nstop: null\nn: 1\nlogit_bias: null \nmodel: gpt-3.5-turbo\n---"
					)
					.setValue(this.plugin.settings.defaultChatFrontmatter)
					.onChange(async (value) => {
						this.plugin.settings.defaultChatFrontmatter = value;
						await this.plugin.saveSettings();
					})
			);

		// stream toggle
		new Setting(containerEl)
			.setName("Stream")
			.setDesc("Stream responses from OpenAI")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.stream)
					.onChange(async (value) => {
						this.plugin.settings.stream = value;
						await this.plugin.saveSettings();
					})
			);

		// folder for chat files
		new Setting(containerEl)
			.setName("Chat Folder")
			.setDesc("Path to folder for chat files")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.chatFolder)
					.onChange(async (value) => {
						this.plugin.settings.chatFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// folder for chat file templates
		new Setting(containerEl)
			.setName("Chat Template Folder")
			.setDesc("Path to folder for chat file templates")
			.addText((text) =>
				text
					.setPlaceholder("chat-templates")
					.setValue(this.plugin.settings.chatTemplateFolder)
					.onChange(async (value) => {
						this.plugin.settings.chatTemplateFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// generate at cursor toggle
		new Setting(containerEl)
			.setName("Generate at Cursor")
			.setDesc("Generate text at cursor instead of end of file")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.generateAtCursor)
					.onChange(async (value) => {
						this.plugin.settings.generateAtCursor = value;
						await this.plugin.saveSettings();
					})
			);

		// automatically infer title
		new Setting(containerEl)
			.setName("Automatically Infer Title")
			.setDesc(
				"Automatically infer title after 4 messages have been exchanged"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoInferTitle)
					.onChange(async (value) => {
						this.plugin.settings.autoInferTitle = value;
						await this.plugin.saveSettings();
					})
			);

		// date format for chat files
		new Setting(containerEl)
			.setName("Date Format")
			.setDesc(
				"Date format for chat files. Valid date blocks are: YYYY, MM, DD, hh, mm, ss"
			)
			.addText((text) =>
				text
					.setPlaceholder("YYYYMMDDhhmmss")
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value;
						await this.plugin.saveSettings();
					})
			);

		// heading level
		new Setting(containerEl)
			.setName("Heading Level")
			.setDesc(
				"Heading level for messages (example for heading level 2: '## role::user'). Valid heading levels are 0, 1, 2, 3, 4, 5, 6"
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.headingLevel.toString())
					.onChange(async (value) => {
						this.plugin.settings.headingLevel = parseInt(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Infer title language")
			.setDesc("Language to use for title inference.")
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					English: "English",
					Japanese: "Japanese",
					Spanish: "Spanish",
					French: "French",
					German: "German",
					Chinese: "Chinese",
					Korean: "Korean",
					Italian: "Italian",
					Russian: "Russian",
				});
				dropdown.setValue(this.plugin.settings.inferTitleLanguage);
				dropdown.onChange(async (value) => {
					this.plugin.settings.inferTitleLanguage = value;
					await this.plugin.saveSettings();
				});
			});
	}
}
