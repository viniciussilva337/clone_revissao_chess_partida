# ♞ Revisão de Partidas (grátis)

Revisão de partidas do chess.com no estilo "Game Review" — **de graça** e rodando
**100% no seu navegador** com o Stockfish 18 (WASM). Nada de servidor, nada de login.

## O que faz

- Busca suas partidas recentes pela [API pública do chess.com](https://www.chess.com/news/view/published-data-api)
  (só precisa do seu usuário) — ou você cola o PGN de qualquer partida.
- Analisa cada posição com o Stockfish (MultiPV 2) e classifica cada lance:
  **Brilhante, Ótimo, Melhor, Excelente, Bom, Teoria, Imprecisão, Erro, Chance perdida e Capivarada**.
- Calcula a **precisão** de cada jogador.
- Mostra **barra de avaliação**, **gráfico da partida** (clicável), seta com o melhor lance,
  a melhor linha e a continuação esperada.
- Identifica a **abertura** (base de dados do Lichess, ~3800 posições).

Atalhos: `←` `→` navegam, `Home`/`End` vão pro início/fim, `F` gira o tabuleiro.

## Como usar

### Online (GitHub Pages)

1. No GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
2. Escolha a branch e a pasta `/ (root)` e salve.
3. Em alguns minutos o site fica em `https://<seu-usuario>.github.io/clone_revissao_chess_partida/`.

### Local

Precisa de um servidor HTTP qualquer (módulos JS e Web Workers não funcionam abrindo o arquivo direto):

```bash
python3 -m http.server 8000
```

Depois abra <http://localhost:8000>.

## Como a classificação funciona

A avaliação do motor (centipeões) é convertida em **% de chance de vitória** com a fórmula do Lichess:

```
vitória% = 50 + 50 · (2 / (1 + e^(−0.00368208 · cp)) − 1)
```

Para cada lance, compara-se a chance de vitória antes (com o melhor lance) e depois (com o lance jogado):

| Perda de vitória% | Classificação |
|---|---|
| lance do motor | Melhor |
| ≤ 2 | Excelente |
| ≤ 5 | Bom |
| ≤ 10 | Imprecisão |
| ≤ 20 | Erro |
| > 20 | Capivarada |

Extras:
- **Teoria**: a posição resultante está na base de aberturas.
- **Brilhante**: lance bom que sacrifica material (deixa peça pendurada ou perde ≥ 2 pontos na linha do motor), sem a posição já estar totalmente ganha.
- **Ótimo**: o lance do motor quando a 2ª melhor opção é muito pior (≥ 15% de vitória) — e não é só uma recaptura.
- **Chance perdida**: o adversário errou e você não aproveitou.
- **Precisão**: fórmula de precisão por lance do Lichess, combinando média aritmética e harmônica.

As regras são uma aproximação: os números não vão bater exatamente com os do chess.com
(que usa um modelo próprio e fechado), mas a ideia é a mesma.

A profundidade padrão é 15 (uma partida de 40 lances leva menos de 1 minuto num computador comum).
Dá pra mudar em **Configurações**.

## Estrutura

```
index.html            página
css/style.css         estilos
js/app.js             interface (tabuleiro, lista de lances, gráfico)
js/review.js          classificação dos lances e precisão (sem DOM)
js/engine.js          wrapper do Stockfish em Web Worker
js/chesscom.js        API pública do chess.com
data/openings.json    aberturas (gerado por tools/build-openings.mjs)
vendor/               Stockfish.js 18 lite, Chessground 9, chess.js 1.4
```

## Créditos e licença

- [Stockfish.js](https://github.com/nmrugg/stockfish.js) — GPLv3
- [Chessground](https://github.com/lichess-org/chessground) — GPLv3
- [chess.js](https://github.com/jhlywa/chess.js) — BSD-2
- [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) — CC0

Como usa componentes GPLv3, este projeto também é distribuído sob a **GPLv3** (ver `LICENSE`).
Projeto independente, sem vínculo com o chess.com.
