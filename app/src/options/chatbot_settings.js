/*
 Copyright (c) 2020 amano <amano@miku39.jp>

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

var ChatBotTable;


window.addEventListener( 'load', async ( ev ) => {
    ChatBotTable = new Tabulator( "#opt-chatbot-table", {
        height: 240,
        // data:tabledata, //assign data to table
        layout: "fitColumns", //fit columns to width of table (optional)
        movableRows: true,
        columns: [ //Define Table Columns
            {rowHandle: true, formatter: "handle", headerSort: false, frozen: true, width: 30, minWidth: 30},
            {
                title: "コメント元",
                field: "msg_from",
                editor: "select",
                editorParams: {"0": "視聴者", "1": "システムメッセージ"},
                width: 150
            },
            {title: "キーワード", field: "keyword", editor: "input"},
            {title: "応答メッセージ", field: "reply", hozAlign: "left", editor: "input"},
            {title: "正規表現", field: "regexp", editor: "tickCross", width: 100}
        ],
        rowContextMenu: [
            {
                label: "行を削除",
                action: function( e, row ){
                    row.delete();
                }
            },
        ]
    } );

    let result = await browser.storage.local.get( 'chatbot' );
    let chatbot_config = result.chatbot;
    ChatBotTable.setData( chatbot_config );

    $( '#btn-add' ).on( 'click', ( ev ) => {
        ChatBotTable.addRow( {} );
    } );
    $( '#btn-save-config' ).on( 'click', ( ev ) => {
        let data = ChatBotTable.getData();
        console.log( data );

        browser.storage.local.set( {
            'chatbot': data
        } );
    } );
} );
