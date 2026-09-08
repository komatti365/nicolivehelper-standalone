/*
 Copyright (c) 2017-2018 amano <amano@miku39.jp>

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

class VideoInformation {
    constructor(){
        this.user_id = '';
        this.user_nickname = '';
        this.video_id = '';
        this.title = '';
        this.description = '';
        this.thumbnail_url = '';
        this.first_retrieve = 0;
        this.length = '0:00';
        this.length_ms = 0;
        this.view_counter = 0;
        this.comment_num = 0;
        this.mylist_counter = 0;
        this.tags = {};
        this.tags_locked = {};
        this.tags_array = [];
        this.filesize = 0;
        this.highbitrate = 0;
        this.lowbitrate = 0;
        this.movie_type = '';
        this.no_live_play = 0;
        this.mylistcomment = '';
        this.classify = '';

        this.is_played = false;         ///< 再生済みフラグ
        this.play_time = 0;             ///< 再生時刻
        this.self_request = false;      ///< 自貼り
        this.request_comment_no = 0;    ///< リクエストのコメント番号
        this.request_user_id = '';      ///< リク主のユーザーID
        this.rights_code = '';          ///< JWIDの作品コードなど権利関係処理用のもの
    }
}

class Comment {
    constructor(){
        this.anonimity = 0;

        this.comment_no = 0;
        this.no = 0;

        this.content = '';
        this.text = '';
        this.text_notag = '';

        this.date = 0;      ///< 秒
        this.date_usec = 0; ///< マイクロ秒
        this.locale = '';
        this.mail = '';
        this.name = '';
        this.premium = 0;
        this.score = 0;
        this.thread = 0;
        this.user_id = '';
        this.vpos = 0;
        this.yourpost = 0;
    }
}
