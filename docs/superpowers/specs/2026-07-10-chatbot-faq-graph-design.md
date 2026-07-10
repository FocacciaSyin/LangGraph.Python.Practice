# 客服 FAQ Graph 設計

## 目的

將數字運算的 Basic Graph 改為不需 LLM API 的客服 FAQ 聊天機器人，讓學習者以一段使用者問題、路由判斷與機器人回覆理解 LangGraph 的 state、node 與 conditional edge。

## 工作流

```text
START -> understand_question
          |-- payment --> answer_payment --> END
          |-- return  --> answer_return  --> END
          `-- unknown --> answer_unknown --> END
```

`understand_question` 將使用者問題加入 `path`。路由函式先判斷訊息是否包含「付款」，再判斷是否包含「退貨」；兩者皆不符合時前往未知問題的回覆。此優先順序讓同時出現兩個關鍵字的問題有確定行為。

## State 與回覆

使用 `FaqState`：

- `user_message: str`：單次使用者問題。
- `reply: str`：FAQ node 產生的回覆。
- `path: Annotated[list[str], operator.add]`：累積經過的 node 名稱。

三種固定回覆如下：

- 付款：`您可以使用信用卡或轉帳付款。`
- 退貨：`請在收到商品後七天內申請退貨。`
- 未知：`我目前可以協助付款或退貨問題。`

## 對外入口與 CLI

`run_basic_graph(user_message: str)` 接收非空白字串，建立初始 `FaqState` 後呼叫已編譯的 graph；非字串或空白字串應拋出 `TypeError`。

`examples/basic_graph.py` 改為接收一個位置參數 `user_message`，輸出機器人回覆與 route path。例如：

```powershell
uv run python examples/basic_graph.py "如何付款？"
```

## 測試與文件

- 將既有數字分支測試替換為付款、退貨、未知問題與無效輸入測試。
- README 的 Basic Graph 教學改為執行上述三種問題，並解釋 state、路由與累積 path。
- Checkpoint Graph 範例與其文件說明維持不變。
