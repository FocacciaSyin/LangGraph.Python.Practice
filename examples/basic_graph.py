# argparse 是 Python 標準庫，用來解析命令列參數
# 例如執行 `python basic_graph.py "如何付款？"` 時，argparse 會把 "如何付款？" 抓出來
import argparse

# 從我們自己寫的套件中匯入 run_basic_graph 函式
# langgraph_python_practice 是 src/ 下的套件名稱
# run_basic_graph 會啟動整個 LangGraph 流程並回傳最終的 state
from langgraph_python_practice.basic_graph import run_basic_graph


def main() -> None:
    # 建立一個命令列參數解析器，description 是執行 --help 時顯示的說明文字
    parser = argparse.ArgumentParser(description="執行客服 FAQ LangGraph 範例")

    # 定義一個必填的位置參數，名稱為 user_message
    # 執行時必須在指令後面加上使用者問題，例如：python basic_graph.py "如何付款？"
    parser.add_argument("user_message", help="使用者的客服問題")

    # parse_args() 會實際讀取命令列輸入並解析
    # 解析結果存在 args 物件裡，透過 args.user_message 取得使用者輸入的字串
    args = parser.parse_args()

    # 將使用者問題傳入 LangGraph 流程，回傳值是完整的 FaqState 字典
    # 內容包含：user_message（原始問題）、reply（機器人回覆）、path（走過的節點清單）
    result = run_basic_graph(args.user_message)

    # f-string 格式化字串：{result['reply']} 會替換成實際的回覆內容
    print(f"機器人：{result['reply']}")

    # result['path'] 是一個 list，例如 ["understand_question", "answer_payment"]
    # ' -> '.join(...) 會把清單裡的每個元素用 " -> " 串接成一行字串
    # 輸出範例：路徑：understand_question -> answer_payment
    print(f"路徑：{' -> '.join(result['path'])}")


# 這是 Python 的慣用寫法：當直接執行此檔案時才會跑 main()
# 如果是被其他檔案 import，則不會自動執行
if __name__ == "__main__":
    main()
