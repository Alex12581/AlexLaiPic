import _ from 'lodash';
import DOMAttachedObject from 'vj/components/DOMAttachedObject';
import type { Node } from 'prosemirror-model';
import { nanoid } from 'nanoid';
import request from 'vj/utils/request';

interface MonacoOptions {
  language?: string;
  onChange?: (val: string) => any;
  theme?: string;
  model?: string;
  autoResize?: boolean;
  autoLayout?: boolean;
  value?: string;
  hide?: string[];
}
type Options = MonacoOptions;

export default class VjEditor extends DOMAttachedObject {
  static DOMAttachKey = 'vjEditorInstance';
  isValid: boolean;
  private lock: boolean;
  height = 0;
  menu: JQuery<HTMLDivElement>;
  root: JQuery<HTMLDivElement>;
  model: import('../monaco').default.editor.IModel;
  editor: import('../monaco').default.editor.IStandaloneCodeEditor;
  milkdown: import('@milkdown/core').Editor & {
    setValue?: (val: string) => void;
    getValue?: () => string;
    dispose?: () => void;
  };

  constructor($dom, public options: Options = {}) {
    super($dom);
    $dom.hide();
    this.root = $('<div class="editor-root"></div>');
    this.menu = $('<div class="editor-menu"></div>');
    const editor = $('<div class="editor-main"></div>');
    const left = $('<div class="editor-col textbox" style="height:100%"></div>');
    const right = $('<div class="editor-col textbox typo" style="display:none;height:100%"></div>');
    this.root.append(this.menu, editor);
    editor.append(left, right);
    $($dom).parent().append(this.root);
    this.initMonaco(left.get(0));
    if ((options?.language || 'markdown') === 'markdown') this.initMilkdown(right.get(0));
  }

  async initMonaco(ele) {
    const { load } = await import('vj/components/monaco/loader');
    const {
      onChange, language = 'markdown',
      theme = UserContext.monacoTheme || 'vs-light',
      model = `file://model-${Math.random().toString(16)}`,
      autoResize = true, autoLayout = true,
      hide = [],
    } = this.options;
    const { monaco, registerAction } = await load([language]);
    const hasFocus = this.$dom.is(':focus') || this.$dom.hasClass('autofocus');
    const value = this.options.value || this.$dom.val();
    this.model = typeof model === 'string'
      ? monaco.editor.getModel(monaco.Uri.parse(model))
      || monaco.editor.createModel(value, language === 'auto' ? undefined : language, monaco.Uri.parse(model))
      : model;
    if (!this.options.model) this.model.setValue(value);
    const cfg: import('../monaco').default.editor.IStandaloneEditorConstructionOptions = {
      theme,
      lineNumbers: 'on',
      glyphMargin: true,
      lightbulb: { enabled: true },
      model: this.model,
      minimap: { enabled: false },
      hideCursorInOverviewRuler: true,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
    };
    if (autoLayout) cfg.automaticLayout = true;
    let prevHeight = 0;
    const updateEditorHeight = () => {
      const editorElement = this.editor.getDomNode();
      if (!editorElement) return;
      const lineHeight = this.editor.getOption(monaco.editor.EditorOption.lineHeight);
      const lineCount = this.editor.getModel()?.getLineCount() || 1;
      let height = Math.max(this.editor.getTopForLineNumber(lineCount + 1) + lineHeight, this.height);
      if (prevHeight !== height) {
        if (window.innerHeight * 1.5 < height) {
          height = window.innerHeight;
          this.editor.updateOptions({
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              handleMouseWheel: true,
            },
          });
        } else {
          this.editor.updateOptions({
            scrollbar: {
              vertical: 'hidden',
              horizontal: 'hidden',
              handleMouseWheel: false,
            },
          });
        }
        prevHeight = height;
        editorElement.style.height = `${height}px`;
        this.editor.layout();
      }
    };
    if (autoResize) {
      cfg.wordWrap = 'bounded';
      cfg.scrollBeyondLastLine = false;
    }
    this.editor = monaco.editor.create(ele, cfg);
    if (hide.length) {
      const ranges = [];
      for (const text of hide) {
        const found = this.model.findMatches(text, true, false, true, '', true);
        ranges.push(...found.map((i) => i.range));
      }
      this.editor.deltaDecorations([], ranges.map((range) => ({ range, options: { inlineClassName: 'decoration-hide' } })));
    }
    registerAction(this.editor, this.model, this.$dom);
    if (autoResize) {
      this.editor.onDidChangeModelDecorations(() => {
        updateEditorHeight(); // typing
        requestAnimationFrame(updateEditorHeight); // folding
      });
    }
    this.editor.onDidChangeModelContent(() => {
      const val = this.editor.getValue({ lineEnding: '\n', preserveBOM: false });
      this.$dom.val(val);
      this.$dom.text(val);
      if (this.lock) return;
      this.lock = true;
      this.milkdown?.setValue(val);
      onChange?.(val);
      this.lock = false;
    });
    this.isValid = true;
    if (hasFocus) this.focus();
    if (autoResize) updateEditorHeight();
    // @ts-ignore
    window.model = this.model;
    // @ts-ignore
    window.editor = this.editor;
  }

  async initMilkdown(ele) {
    const pagename = document.documentElement.getAttribute('data-page');
    const isProblemPage = ['problem_create', 'problem_edit'].includes(pagename);
    const isProblemEdit = pagename === 'problem_edit';
    const [
      {
        Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx,
      },
      { nord }, { replaceAll }, { gfm }, { listener, listenerCtx },
      { math }, { history }, { clipboard }, { tooltip }, { slash },
      { emoji }, { upload, uploadPlugin }, { diagram }, { prism }, { cursor },
      { menu },
    ] = await Promise.all([
      import('@milkdown/core'), import('./theme'), import('@milkdown/utils'),
      import('@milkdown/preset-gfm'), import('@milkdown/plugin-listener'),
      import('@milkdown/plugin-math'),
      import('@milkdown/plugin-history'),
      import('@milkdown/plugin-clipboard'),
      import('@milkdown/plugin-tooltip'),
      import('@milkdown/plugin-slash'),
      import('@milkdown/plugin-emoji'),
      import('@milkdown/plugin-upload'),
      import('@milkdown/plugin-diagram'),
      import('@milkdown/plugin-prism'),
      import('@milkdown/plugin-cursor'),
      import('@milkdown/plugin-menu'),
    ]);

    const uploader: import('@milkdown/plugin-upload').Uploader = async (files, schema) => {
      const images: File[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files.item(i);
        if (!file) continue;
        if (!file.type.includes('image')) continue;
        images.push(file);
      }
      const nodes: Node[] = await Promise.all(
        images.map(async (image) => {
          const filename = `${nanoid()}.${image.name.split('.').pop()}`;
          const data = new FormData();
          data.append('filename', filename);
          data.append('file', image);
          data.append('operation', 'upload_file');
          if (isProblemEdit) data.append('type', 'additional_file');
          await request.postFile(isProblemEdit ? './files' : '/file', data);
          return schema.nodes.image.createAndFill({
            src: `${isProblemPage ? 'file://' : `/file/${UserContext._id}/`}${filename}`,
            alt: filename,
          }) as Node;
        }),
      );
      return nodes;
    };

    this.milkdown = Editor.make()
      .use(nord).use(listener).use(gfm)
      .use(math).use(history).use(clipboard).use(tooltip).use(slash)
      .use(emoji).use(diagram).use(prism).use(cursor).use(menu)
      .use(upload.configure(uploadPlugin, { uploader }))
      .config((ctx) => {
        ctx.set(defaultValueCtx, this.$dom.val());
        ctx.set(rootCtx, ele);
        ctx.get(listenerCtx).markdownUpdated((c, markdown) => {
          this.$dom.val(markdown);
          this.$dom.text(markdown);
          if (this.lock) return;
          this.lock = true;
          if (this.model) {
            const range = this.model.getFullModelRange();
            this.model.pushEditOperations([], [{ range, text: markdown }], undefined);
          } else this.editor?.setValue?.(markdown);
          this.options?.onChange?.(markdown);
          this.lock = false;
        });
        ctx.get(listenerCtx).updated(() => {
          this.height = $(ele).height();
        });
      });
    this.milkdown.setValue = (val) => this.milkdown.action(replaceAll(val));
    this.milkdown.getValue = () => this.milkdown.action((ctx) => {
      const editorView = ctx.get(editorViewCtx);
      const serializer = ctx.get(serializerCtx);
      return serializer(editorView.state.doc);
    });
    this.milkdown.dispose = () => {
      const view = this.milkdown.action((ctx) => ctx.get(editorViewCtx));
      const root = this.milkdown.action((ctx) => ctx.get(rootCtx)) as HTMLElement;
      root?.firstChild?.remove();
      view?.destroy();
    };
    await this.milkdown.create();
    $(ele).show();
    this.menu.children().remove();
    this.menu.prepend(this.root.find('.milkdown-menu'));
    this.isValid = true;
  }

  destory() {
    this.detach();
    this.editor?.dispose();
    this.milkdown?.dispose();
    this.root?.remove();
  }

  ensureValid() {
    if (!this.isValid) throw new Error('Editor is not loaded');
  }

  value(val?: string) {
    this.ensureValid();
    if (typeof val === 'string') {
      this.editor?.setValue(val);
      this.milkdown?.setValue(val);
      return val;
    }
    return (this.editor || this.milkdown)?.getValue({ lineEnding: '\n', preserveBOM: false });
  }

  focus() {
    this.ensureValid();
    this.editor.focus();
    const range = this.model.getFullModelRange();
    this.editor.setPosition({ lineNumber: range.endLineNumber, column: range.endColumn });
  }
}

_.assign(VjEditor, DOMAttachedObject);
