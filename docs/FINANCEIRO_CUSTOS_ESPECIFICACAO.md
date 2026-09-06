# Especificação para homologação — Financeiro e parametrização de custos

> **Estado:** homologado e implementado em 06/09/2026.

## 1. Entendimento do produto

A feature amplia o SAE com dois fluxos relacionados, porém separados:

1. **Configurações → Custos:** administra o plano de classificação usado pelos
   lançamentos financeiros.
2. **Financeiro:** registra receitas e despesas, controla pagamento, recorrência e
   contas a pagar.

A página atualmente chamada Custos deverá passar a se chamar **Financeiro**. Na
página Configurações haverá uma navegação interna por section headings/tabs:

- Configuração do capital — fluxo existente;
- Custos — novo fluxo de categorias, subcategorias e descrições.

A separação é importante: Configurações define opções reutilizáveis; Financeiro
registra fatos monetários. Alterar um cadastro futuro não deve reclassificar
silenciosamente lançamentos históricos.

## 2. Ajuste de terminologia recomendado

O briefing alterna “novo custo”, “nova categoria” e “descrição da subcategoria”.
Para evitar um CRUD ambíguo, propõe-se este vocabulário:

- **Fonte:** Receita ou Despesa.
- **Tipo de custo:** Fixo ou Variável; aplicável a despesas.
- **Categoria:** agrupador amplo, por exemplo `CUSTOS DE FUNCIONAMENTO`.
- **Subcategoria:** agrupador subordinado, por exemplo `UTILIDADES`.
- **Item/descrição:** opção final selecionável no lançamento, por exemplo `ÁGUA`,
  `LUZ`, `INTERNET` ou `ALUGUEL`.

Assim, o encadeamento dos selects será:

```text
Fonte → Tipo de custo → Categoria → Subcategoria → Item/descrição
```

Para Receita, `Tipo de custo` não se aplica e o encadeamento será:

```text
Fonte Receita → Categoria → Subcategoria → Item/descrição
```

## 3. Categorias iniciais

A lista recebida contém nomes repetidos, especialmente `CUSTOS DE FUNCIONAMENTO`,
`TAXAS GERAIS` e `CUSTOS GERAIS`. A recomendação é criar cada categoria apenas
uma vez e representar a diversidade nas subcategorias/itens.

Categorias de despesas sugeridas como carga inicial, sujeitas à homologação:

- SALÁRIOS FREELANCER;
- CUSTOS DE FUNCIONAMENTO;
- LANCHE FUNCIONÁRIO;
- MOTOBOYS;
- CUSTOS GERAIS;
- PRÓ-LABORE;
- EMPRÉSTIMOS;
- TAXAS GERAIS;
- IMPOSTO.

Itens iniciais sugeridos para `CUSTOS DE FUNCIONAMENTO`:

- ÁGUA;
- LUZ;
- SISTEMA;
- INTERNET;
- ANÚNCIOS;
- ALUGUEL.

Não é recomendado inserir `Empréstimos` como item de Custos de Funcionamento se
já existir a categoria EMPRÉSTIMOS.

## 4. Modelo de dados Sheets recomendado

Para respeitar “uma aba = uma entidade”, evitar colunas variáveis e preservar
histórico, serão necessárias entidades separadas.

### 4.1 Aba `Financeiro_Categorias`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `UUID` | UUID | Gerado pelo GAS |
| `data_cadastro` | datetime ISO | Gerado pelo servidor |
| `fonte` | enum | `RECEITA` ou `DESPESA` |
| `tipo_custo` | enum/null | `FIXO`, `VARIAVEL` ou vazio para Receita |
| `nome` | string | Nome único no mesmo contexto |
| `ativo` | boolean | Inativação preserva histórico |
| `atualizado_em` | datetime ISO | Auditoria |

### 4.2 Aba `Financeiro_Subcategorias`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `UUID` | UUID | Gerado pelo GAS |
| `data_cadastro` | datetime ISO | Gerado pelo servidor |
| `categoria_UUID` | UUID | Categoria pai obrigatória |
| `nome` | string | Único dentro da categoria |
| `ativo` | boolean | Inativação preserva histórico |
| `atualizado_em` | datetime ISO | Auditoria |

### 4.3 Aba `Financeiro_Itens`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `UUID` | UUID | Gerado pelo GAS |
| `data_cadastro` | datetime ISO | Gerado pelo servidor |
| `subcategoria_UUID` | UUID | Subcategoria pai obrigatória |
| `nome` | string | Ex.: Água, Luz, Internet |
| `descricao` | string | Observação opcional do cadastro |
| `ativo` | boolean | Inativação preserva histórico |
| `atualizado_em` | datetime ISO | Auditoria |

### 4.4 Aba `Financeiro_Lancamentos`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `UUID` | UUID | Identificador do lançamento |
| `data_cadastro` | datetime ISO | Momento real da inclusão |
| `data_movimento` | data ISO | Data informada pelo usuário |
| `fonte` | enum | `RECEITA` ou `DESPESA` |
| `tipo_custo_snapshot` | enum/null | Fixo/Variável no lançamento |
| `categoria_UUID` | UUID | Referência ao cadastro |
| `categoria_snapshot` | string | Nome histórico |
| `subcategoria_UUID` | UUID | Referência ao cadastro |
| `subcategoria_snapshot` | string | Nome histórico |
| `item_UUID` | UUID | Item selecionado |
| `nome_snapshot` | string | Nome/descrição histórica |
| `descricao` | string | Texto livre do lançamento |
| `valor` | número | Valor normalizado, maior ou igual a zero |
| `data_vencimento` | data ISO/null | Obrigatória para despesa |
| `pago` | boolean | Estado da conta |
| `pago_em` | datetime ISO/null | Auditoria da quitação |
| `recorrencia_UUID` | UUID/null | Relação com recorrência |
| `excluido` | boolean | Exclusão lógica |
| `excluido_em` | datetime ISO/null | Auditoria |
| `atualizado_em` | datetime ISO | Auditoria |

### 4.5 Aba `Financeiro_Recorrencias`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `UUID` | UUID | Identificador da regra |
| `lancamento_origem_UUID` | UUID | Despesa que criou a regra |
| `frequencia` | enum | Inicialmente `MENSAL` |
| `dia_vencimento` | inteiro | Dia pretendido no mês |
| `proxima_competencia` | data ISO | Controle idempotente |
| `ativa` | boolean | Toggle liga/desliga |
| `criado_em` | datetime ISO | Auditoria |
| `encerrado_em` | datetime ISO/null | Auditoria |

Os snapshots impedem que renomear/inativar uma categoria altere lançamentos já
consolidados.

## 5. Configurações → Custos

### 5.1 Interface

- Section heading com tabs `Configuração do capital` e `Custos`.
- Filtros por Fonte, Tipo de custo, Categoria e Subcategoria.
- Botões separados: Nova categoria, Nova subcategoria e Novo item.
- Tabela visual unificada por join, exibindo:
  `UUID | data cadastro | fonte | tipo custo | categoria | subcategoria |
  descrição/item | status | ações`.
- Drawer lateral com backdrop; botão fechar visível do lado externo; fecha por
  `Esc`, backdrop e botão; bloqueia scroll; mantém foco e devolve foco ao gatilho.
- CRUD completo com edição, inativação/reativação e confirmação destrutiva.

### 5.2 Validações

- Fonte obrigatória em todos os níveis.
- Tipo Fixo/Variável obrigatório para classificação de Despesa.
- Categoria obrigatória antes de criar subcategoria.
- Subcategoria obrigatória antes de criar item.
- Nomes normalizados e sem duplicidade no mesmo pai/contexto.
- Cadastros utilizados não são apagados fisicamente; tornam-se inativos.
- Selects de lançamentos mostram apenas opções ativas, enquanto históricos
  continuam legíveis pelos snapshots.

## 6. Página Financeiro

### 6.1 Drawer Novo lançamento

O drawer terá tabs Receita e Despesa.

**Receita**

- data do movimento;
- badge com borda `Receita`;
- categoria;
- subcategoria;
- item/nome;
- descrição livre;
- valor.

**Despesa**

- data do movimento;
- data de vencimento;
- tipo Fixo/Variável;
- categoria filtrada pelo tipo;
- subcategoria filtrada pela categoria;
- item/nome filtrado pela subcategoria;
- descrição livre;
- valor;
- toggle Pago;
- toggle Despesa recorrente.

Toda filtragem também será validada no GAS. Não será aceito combinar uma
subcategoria com categoria diferente manipulando o payload do navegador.

### 6.2 Tabela financeira

Colunas:

`UUID | data cadastro | fonte | tipo | categoria | subcategoria | nome | valor |
vencimento | pago | recorrente | ações`.

Recomendações adicionais:

- paginação server-side, 20 itens por página;
- filtros por período, fonte, pagamento, tipo, categoria e busca;
- ordenação padrão por vencimento e data de cadastro;
- edição usa snapshots atuais do próprio lançamento;
- exclusão lógica;
- em celular, cards expansíveis em vez de tabela larga.

## 7. Recorrência

Não é recomendável inserir infinitas linhas futuras no momento do cadastro. A
arquitetura proposta combina:

1. uma regra em `Financeiro_Recorrencias`;
2. materialização idempotente de uma janela futura limitada;
3. trigger GAS diário para garantir as próximas ocorrências;
4. verificação também ao abrir Financeiro, caso o trigger falhe.

Regra homologada: materializar os próximos 12 meses e repor a janela diariamente.
Cada ocorrência terá UUID próprio e vínculo com a recorrência. Desativar a regra
impede novas ocorrências, sem apagar despesas já materializadas.

Pontos de borda:

- vencimento no dia 29, 30 ou 31 em mês curto;
- mudança do valor/categoria da recorrência;
- edição somente desta ocorrência versus desta e das próximas;
- marcar uma ocorrência como paga sem afetar as demais;
- idempotência para não duplicar parcelas quando trigger e abertura coincidirem.

## 8. Contas vencidas e a vencer

Sessões propostas, sempre considerando despesas não excluídas e não pagas:

- **Vencidas:** vencimento anterior a hoje;
- **Vencem hoje:** vencimento igual a hoje;
- **Vencem amanhã:** vencimento igual a hoje + 1;
- **Próximos 7 dias:** vencimento entre hoje + 2 e hoje + 7, evitando duplicar a
  tabela de amanhã.

Cada sessão mostrará quantidade, total monetário e uma tabela curta com acesso ao
lançamento completo. O timezone será `America/Sao_Paulo` e a data de referência
virá do servidor.

## 9. KPIs propostos

Para mês e ano:

- contas a pagar: soma das despesas não pagas;
- contas pagas: soma das despesas pagas;
- receitas lançadas;
- despesas totais;
- saldo: receitas menos despesas;
- quantidade de contas, como informação secundária.

O filtro temporal precisa ser homologado: por `data_movimento`, `data_vencimento`
ou ambos conforme o KPI. A recomendação é usar vencimento para contas a pagar e
data do movimento para DRE/fluxo realizado.

## 10. Backend GAS previsto

- `setupFinanceModule()` — setup idempotente das cinco entidades e seeds.
- CRUD de categorias, subcategorias e itens.
- `getFinanceConfigBootstrap(filters)`.
- `getFinanceBootstrap(filters)`.
- `listFinanceEntries(query)`.
- `createFinanceEntry(input)` / `updateFinanceEntry(input)`.
- `deleteFinanceEntry(uuid)` — lógico.
- `setFinanceEntryPaid(input)`.
- `setRecurrenceStatus(input)`.
- `materializeRecurringExpenses()` — também acionável por trigger.

Requisitos técnicos:

- `LockService` em todas as mutações;
- cálculos e relacionamentos revalidados no servidor;
- datas convertidas para strings ISO antes de `google.script.run`;
- ranges em lote e paginação server-side;
- snapshots de classificação;
- chaves de idempotência nas recorrências;
- respostas `ok_/fail_` com erros de negócio preservados;
- nenhuma API REST externa ou backend fora do GAS.

## 11. Critérios de aceite

- Categoria → subcategoria → item filtra corretamente no cliente e servidor.
- Opção inativa some de novos lançamentos, mas permanece no histórico.
- Receita nunca exige tipo Fixo/Variável.
- Despesa exige vencimento, tipo, categoria, subcategoria e item.
- Toggle Pago persiste e atualiza `pago_em`.
- Recorrência não gera duplicatas e pode ser desativada.
- Ocorrências pagas/históricas não são apagadas ao desativar recorrência.
- Vencidas, hoje, amanhã e próximos 7 dias não se sobrepõem.
- KPIs conciliam com a soma manual da mesma amostra.
- Exclusão é lógica e remove o item das consultas operacionais.
- Drawers funcionam por teclado, backdrop, `Esc` e restauração de foco.
- Nenhuma `Date` não serializável atravessa `google.script.run`.
- Configuração do capital continua funcional na tab separada.

## 12. Homologação

### 12.1 Decisões confirmadas

- O catálogo de despesas terá três níveis: Categoria → Subcategoria → Item.
- Receitas terão fluxo próprio e começarão sem seeds de categoria ou item.
- A lista deduplicada de categorias de Despesa da seção 3 está aprovada.
- “Descrição subcategoria” é o item selecionável final, como Água, Luz e Internet.
- Recorrências serão exclusivamente mensais.
- Vencimentos 29, 30 ou 31 usarão o último dia quando o mês for mais curto.
- A edição de uma ocorrência recorrente afetará somente aquela ocorrência.
- Ao cadastrar uma despesa como paga, `pago_em` será preenchido automaticamente.
- Receitas serão consideradas recebidas imediatamente, sem vencimento/status.
- O recorte “Próximos 7 dias” será D+2 a D+7, sem repetir “amanhã”.
- KPIs priorizarão valor monetário; quantidade será informação secundária.
- Categorias, subcategorias e itens utilizados serão inativados, preservando
  históricos e desaparecendo dos filtros de novos lançamentos.
- Está autorizada a criação das cinco entidades Sheets propostas.
- `setupFinanceModule()` poderá instalar a trigger diária de recorrências.
- Edição e exclusão financeiras continuarão públicas e anônimas, mantendo-se o
  risco de consumo indevido de cotas já documentado no projeto.

O fluxo próprio de Receitas será separado na interface e por `fonte` no modelo de
dados, reutilizando a infraestrutura das entidades para evitar novas abas
redundantes. Seus cadastros começarão vazios e serão criados pelo usuário.

### 12.2 Decisões finais

- A recorrência materializa uma janela de **12 meses futuros**.
- Os KPIs de contas a pagar e pagas usam o mês da **data de vencimento**.

## 13. Implementação entregue

1. congelar terminologia, seeds e regras de recorrência;
2. implementar setup idempotente e validação de schema;
3. implementar repositórios e CRUD do catálogo;
4. criar Configurações com tabs e drawers acessíveis;
5. implementar lançamentos, snapshots e filtros encadeados;
6. implementar recorrência idempotente e trigger;
7. implementar contas a pagar e KPIs;
8. criar a página Financeiro responsiva;
9. testar bordas de datas, concorrência, serialização e cotas;
10. homologar em cópia da planilha antes da publicação.
