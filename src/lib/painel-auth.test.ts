import { describe, it, expect } from "vitest";
import {
  assinarSessao,
  verificarSessao,
  rotaLiberada,
  destinoSeguro,
  decidirAcesso,
  senhaConfere,
  DURACAO_SESSAO_MS,
  SENHA_MIN_PRODUCAO,
  senhaAceitavel,
  inngestLiberado,
  rotaInngest,
} from "./painel-auth";

const SENHA = "senha-de-teste-bem-longa";
const AGORA = 1_760_000_000_000;

describe("assinar/verificar sessão", () => {
  it("aceita token válido dentro do prazo", async () => {
    const token = await assinarSessao(SENHA, AGORA);
    expect(token).not.toContain(SENHA);
    expect(await verificarSessao(token, SENHA, AGORA + 1000)).toBe(true);
  });

  it("recusa token expirado (após 12h)", async () => {
    const token = await assinarSessao(SENHA, AGORA);
    expect(await verificarSessao(token, SENHA, AGORA + DURACAO_SESSAO_MS)).toBe(false);
    expect(await verificarSessao(token, SENHA, AGORA + DURACAO_SESSAO_MS + 1)).toBe(false);
  });

  it("recusa token adulterado (expiração estendida ou assinatura trocada)", async () => {
    const token = await assinarSessao(SENHA, AGORA);
    const [v, exp, sig] = token.split(".") as [string, string, string];
    const expEstendida = `${v}.${Number(exp) + DURACAO_SESSAO_MS * 100}.${sig}`;
    expect(await verificarSessao(expEstendida, SENHA, AGORA)).toBe(false);
    const sigTrocada = `${v}.${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
    expect(await verificarSessao(sigTrocada, SENHA, AGORA)).toBe(false);
    expect(await verificarSessao("lixo", SENHA, AGORA)).toBe(false);
    expect(await verificarSessao("", SENHA, AGORA)).toBe(false);
    expect(await verificarSessao(undefined, SENHA, AGORA)).toBe(false);
  });

  it("troca de senha invalida tokens antigos", async () => {
    const token = await assinarSessao(SENHA, AGORA);
    expect(await verificarSessao(token, "outra-senha", AGORA + 1000)).toBe(false);
  });

  it("senhaConfere só aceita a senha exata", async () => {
    expect(await senhaConfere(SENHA, SENHA)).toBe(true);
    expect(await senhaConfere(`${SENHA}x`, SENHA)).toBe(false);
    expect(await senhaConfere("", "")).toBe(false);
  });
});

describe("rotaLiberada (matcher)", () => {
  it("libera webhook da Meta, Inngest, /entrar, /privacidade e assets", () => {
    for (const p of ["/api/webhooks/whatsapp", "/api/inngest", "/entrar", "/api/entrar", "/privacidade", "/_next/static/x.js", "/favicon.ico"]) {
      expect(rotaLiberada(p), p).toBe(true);
    }
  });
  it("exige sessão no resto, inclusive prefixos parecidos", () => {
    for (const p of ["/", "/importar", "/api/sair", "/api/lotes", "/entrarx", "/api/webhooks/whatsappx", "/api/webhooks/outro"]) {
      expect(rotaLiberada(p), p).toBe(false);
    }
  });
});

describe("destinoSeguro (anti open redirect)", () => {
  it("mantém caminho interno com query", () => {
    expect(destinoSeguro("/importar?lote=1")).toBe("/importar?lote=1");
  });
  it("bloqueia destinos externos ou suspeitos", () => {
    for (const d of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil.com", "/\tevil", "/entrar", "/api/sair", undefined, null, ""]) {
      expect(destinoSeguro(d), String(d)).toBe("/");
    }
  });
});

describe("decidirAcesso", () => {
  it("produção sem PAINEL_SENHA bloqueia tudo que não é público (503)", async () => {
    expect(await decidirAcesso({ pathname: "/", cookie: undefined, senha: undefined, producao: true })).toBe("indisponivel");
    expect(await decidirAcesso({ pathname: "/api/webhooks/whatsapp", cookie: undefined, senha: undefined, producao: true })).toBe("liberar");
  });
  it("sem cookie → nao_autenticado; com cookie válido → liberar", async () => {
    expect(await decidirAcesso({ pathname: "/importar", cookie: undefined, senha: SENHA, producao: true })).toBe("nao_autenticado");
    const token = await assinarSessao(SENHA, AGORA);
    expect(await decidirAcesso({ pathname: "/importar", cookie: token, senha: SENHA, producao: true, agoraMs: AGORA })).toBe("liberar");
  });
});

describe("PAINEL_SENHA curta em produção (falha fechada)", () => {
  const CURTA = "a".repeat(SENHA_MIN_PRODUCAO - 1);
  const MINIMA = "a".repeat(SENHA_MIN_PRODUCAO);

  it("senha com menos de 16 caracteres → indisponivel, mesmo com cookie assinado por ela", async () => {
    const token = await assinarSessao(CURTA, AGORA);
    expect(await decidirAcesso({ pathname: "/", cookie: undefined, senha: CURTA, producao: true })).toBe("indisponivel");
    expect(await decidirAcesso({ pathname: "/importar", cookie: token, senha: CURTA, producao: true, agoraMs: AGORA })).toBe("indisponivel");
    expect(await decidirAcesso({ pathname: "/api/lotes", cookie: token, senha: CURTA, producao: true, agoraMs: AGORA })).toBe("indisponivel");
  });

  it("rotas públicas seguem liberadas (igual à senha ausente)", async () => {
    expect(await decidirAcesso({ pathname: "/api/webhooks/whatsapp", cookie: undefined, senha: CURTA, producao: true })).toBe("liberar");
    expect(await decidirAcesso({ pathname: "/entrar", cookie: undefined, senha: CURTA, producao: true })).toBe("liberar");
  });

  it("exatamente 16 caracteres é aceito", async () => {
    expect(await decidirAcesso({ pathname: "/", cookie: undefined, senha: MINIMA, producao: true })).toBe("nao_autenticado");
    const token = await assinarSessao(MINIMA, AGORA);
    expect(await decidirAcesso({ pathname: "/", cookie: token, senha: MINIMA, producao: true, agoraMs: AGORA })).toBe("liberar");
  });

  it("fora de produção senha curta continua valendo (dev local)", async () => {
    expect(await decidirAcesso({ pathname: "/", cookie: undefined, senha: "dev", producao: false })).toBe("nao_autenticado");
    const token = await assinarSessao("dev", AGORA);
    expect(await decidirAcesso({ pathname: "/", cookie: token, senha: "dev", producao: false, agoraMs: AGORA })).toBe("liberar");
  });

  it("senhaAceitavel", () => {
    expect(senhaAceitavel(undefined, true)).toBe(false);
    expect(senhaAceitavel("", false)).toBe(false);
    expect(senhaAceitavel(CURTA, true)).toBe(false);
    expect(senhaAceitavel(MINIMA, true)).toBe(true);
    expect(senhaAceitavel("x", false)).toBe(true);
  });
});

describe("/api/inngest e INNGEST_SIGNING_KEY", () => {
  it("produção com signing key → liberar (sem sessão)", async () => {
    for (const p of ["/api/inngest", "/api/inngest/x"]) {
      expect(await decidirAcesso({ pathname: p, cookie: undefined, senha: SENHA, producao: true, inngestSigningKey: "signkey-prod-abc" }), p).toBe("liberar");
    }
  });

  it("produção sem signing key (ausente, vazia ou só espaços) → indisponivel", async () => {
    for (const k of [undefined, "", "   "]) {
      expect(await decidirAcesso({ pathname: "/api/inngest", cookie: undefined, senha: SENHA, producao: true, inngestSigningKey: k }), String(k)).toBe("indisponivel");
    }
  });

  it("dev sem signing key continua liberado", async () => {
    expect(await decidirAcesso({ pathname: "/api/inngest", cookie: undefined, senha: undefined, producao: false })).toBe("liberar");
    expect(inngestLiberado({ producao: false, signingKey: undefined })).toBe(true);
  });

  it("a exigência da chave não afeta outras rotas nem prefixos parecidos", async () => {
    expect(await decidirAcesso({ pathname: "/api/webhooks/whatsapp", cookie: undefined, senha: SENHA, producao: true })).toBe("liberar");
    expect(rotaInngest("/api/inngestx")).toBe(false);
    expect(await decidirAcesso({ pathname: "/api/inngestx", cookie: undefined, senha: SENHA, producao: true })).toBe("nao_autenticado");
  });
});
